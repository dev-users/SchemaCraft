"""Group application writes and defer side effects until true SQL completion."""
from __future__ import annotations

import copy
import logging
from contextlib import contextmanager, nullcontext
from contextvars import ContextVar
from dataclasses import dataclass


_GROUPS = ContextVar("schemacraft_postgres_data_groups", default=())
_LOGGER = logging.getLogger(__name__)


@dataclass
class TransactionOutcome:
    """A shared nested outcome; commit means the outer SQL commit completed."""
    postgresql: bool
    committed: bool = False
    completed: bool = False
    rolled_back: bool = False
    deleted_files: int = 0


def _log(app, message):
    try:
        getattr(app, "LOGGER", _LOGGER).exception(message)
    except Exception:
        pass


def _retry_profiles(app):
    try:
        app.schedule_profile_sync_retry()
    except Exception:
        _log(app, "Could not schedule post-commit profile synchronization")


def _registry_snapshot(manager):
    if manager is None:
        return None
    with getattr(manager, "_lock", nullcontext()):
        return copy.deepcopy(manager._registry)


def _recover_rollback(app, store, manager, baseline):
    try:
        app.invalidate_all_dataset_caches()
    except Exception:
        _log(app, "Could not invalidate application caches after SQL rollback")
    if manager is not None:
        try:
            # Fence an ambiguous COMMIT before reading the durable registry.
            # Acquire SQL before the manager lock to preserve lock ordering.
            with store.transaction():
                with getattr(manager, "_lock", nullcontext()):
                    manager._registry = manager._read_registry()
                    manager._postgres_registry_stale = False
        except Exception:
            with getattr(manager, "_lock", nullcontext()):
                # The server may be unavailable during commit failure. Never
                # leave this process presenting its uncommitted registry edits.
                manager._registry = baseline
                manager._postgres_registry_stale = True
                _log(app, "Could not reload identity registry after SQL rollback")


def _flush_cleanup(app, store, cleanup, outcome):
    grouped = {}
    for context, obsolete in cleanup:
        if not obsolete:
            continue
        key = None if context is None else (getattr(context, "schema_id", id(context)), str(getattr(context, "folder", "")))
        if key not in grouped:
            grouped[key] = (context, set())
        grouped[key][1].update(obsolete)
    for context, obsolete in grouped.values():
        try:
            with app.use_context(context):
                # A path removed by an earlier operation may have been retained
                # by a later write in this same SQL group. Read the final data.
                schema = app.read_schema_file()
                records = store.read_dataset(app.current_schema_id())
                retained = {path for record in records for path in app._record_file_paths(schema, record)}
                outcome.deleted_files += app.remove_attachment_files(set(obsolete) - retained)
        except Exception:
            # Leaving an obsolete file is preferable to reporting that the
            # already committed records rolled back or deleting a retained file.
            _log(app, "Attachment cleanup remains pending after SQL commit")


def _flush_profiles(app, profiles):
    latest = {}
    for schema_id, records in profiles:
        latest[schema_id] = records
    for schema_id, records in latest.items():
        try:
            app.synchronize_profile_dependents(schema_id, records)
        except Exception:
            _log(app, "Profile synchronization remains pending after SQL commit")
            _retry_profiles(app)


@contextmanager
def postgres_data_transaction(app):
    """Atomically group current-store writes, identity updates and queued effects.

    ``with postgres_data_transaction(app) as outcome`` leaves Excel behavior
    unchanged. PostgreSQL groups share a ``TransactionOutcome`` through nested
    helper scopes. Even inside an existing raw ``store.transaction()``, owned
    cleanup/profile queues are held by completion callbacks and run only after
    the actual outer commit. Existing external defer queues retain their owner.

    This helper does not publish new attachment files. A caller owning newly
    promoted files must register its filesystem undo with ``store.on_rollback``;
    obsolete file removal belongs inside this context and is deferred safely.
    """
    store = app._postgres_store()
    if store is None:
        outcome = TransactionOutcome(postgresql=False)
        yield outcome
        outcome.committed = outcome.completed = True
        return

    for group in reversed(_GROUPS.get()):
        if group["app"] is app and group["store"] is store:
            # The existing helper owns queues, registry recovery and completion.
            # Joining transaction() still marks a caught nested failure as failed.
            with store.transaction():
                yield group["outcome"]
            return

    outcome = TransactionOutcome(postgresql=True)
    manager = getattr(app, "WORKSPACE_MANAGER", None)
    baseline = _registry_snapshot(manager)
    parent_profiles = app._DEFER_PROFILE_SYNC.get()
    parent_cleanup = app._DEFER_ATTACHMENT_CLEANUP.get()
    profiles, cleanup = [], []
    group = {"app": app, "store": store, "outcome": outcome}

    def after_commit():
        outcome.committed = outcome.completed = True
        if parent_cleanup is not None:
            parent_cleanup.extend(cleanup)
        else:
            _flush_cleanup(app, store, cleanup, outcome)
        if parent_profiles is not None:
            parent_profiles.extend(profiles)
        else:
            _flush_profiles(app, profiles)

    def after_rollback():
        if outcome.completed:
            return
        outcome.rolled_back = outcome.completed = True
        profiles.clear()
        cleanup.clear()
        _recover_rollback(app, store, manager, baseline)

    try:
        with store.transaction():
            if manager is not None and getattr(manager, "_postgres_registry_stale", False):
                # A prior unavailable server required a memory fallback. Reload
                # before another write can replace the durable identity table.
                with getattr(manager, "_lock", nullcontext()):
                    manager._registry = manager._read_registry()
                    baseline = copy.deepcopy(manager._registry)
                    manager._postgres_registry_stale = False
            store.on_commit(after_commit)
            store.on_rollback(after_rollback)
            profile_token = app._DEFER_PROFILE_SYNC.set(profiles)
            cleanup_token = app._DEFER_ATTACHMENT_CLEANUP.set(cleanup)
            group_token = _GROUPS.set((*_GROUPS.get(), group))
            try:
                yield outcome
            finally:
                # Restore scopes before transaction() dispatches its callbacks;
                # otherwise flushing would append back into its own defer queue.
                _GROUPS.reset(group_token)
                app._DEFER_ATTACHMENT_CLEANUP.reset(cleanup_token)
                app._DEFER_PROFILE_SYNC.reset(profile_token)
    except BaseException:
        # Opening a transaction can fail before callbacks are registered. The
        # callback guard also prevents duplicate recovery after a normal rollback.
        # A joined raw outer transaction has not rolled back yet. Its callback
        # must reload the registry after that real rollback, never while reads
        # can still see uncommitted edits on the outer connection.
        context = getattr(store, "_transaction_state", None)
        outer_pending = context is not None and context.get() is not None
        if not outcome.completed and not outer_pending:
            after_rollback()
        raise
