# Alpha 27 — integrated lists, deterministic focus, and hot Builder saves

## Entry lists

Editable list fields now use one integrated combobox instead of a text input,
browser datalist, and external plus button. Typing filters the allowed values
in real time. When no similar value exists, the dropdown itself offers to add
the typed value. Dependent lists send the active dependency token when adding
an option, so the new value belongs to the controlling value used by the
current profile.

A non-empty typed value is invalid until it matches an allowed option or the
user adds it. Tab and pointer focus changes are blocked at that field and the
inline menu reopens with the available action.

## Keyboard and dates

Entry computes Tab targets from visible, enabled field controls only. Category
headings and action buttons are excluded, including inside nested repeated
cards. Shift+Tab uses the same list in reverse.

Manual dates again consist of exactly three controls: day, month, and year.
Pressing `-` in day focuses month; pressing it in month focuses year. The dash
is navigation only and is never stored. No date selection automatically moves
focus; ordinary Tab remains the only general field-navigation mechanism.

Recent-profile titles join configured title fields with spaces, matching the
search-result title contract.

## Related-person mapping

The field mapping editor is explicitly ordered:

1. Choose main-category fields, or choose a unique checkbox that identifies
   one card in a repeated source category.
2. Choose the source field.

All non-file, non-system fields in the selected source scope remain visible;
type-incompatible choices are labelled and disabled. Backend validation still
requires matching field types and a unique-across-cards checkbox for repeated
sources.

## History settings

The interface settings page has two dedicated groups:

- Independent page limits for Entry, Search, Import, and Export.
- Independent Home-card limits for Data, Builder, Search, Import, and Export.

Every value is a free integer from 1 to 100. Home defaults to three records per
card. Existing `home_history_limit` values migrate to all five Home settings.

## Builder performance diagnosis and correction

Two interactions caused the long save pauses:

- Every schema edit started a separate background Excel writer. Writers for
  linked/global definitions queued against the same workbook lock.
- The projection invalidated the newly built dataset index. The next edit then
  reopened and re-indexed the entire workbook before it could commit.

Alpha 27 replaces those writers with one coalescing maintenance queue. Workbook
generation runs outside the request lock and performs only a short revision
check plus atomic replace while locked. The projection then republishes a hot
snapshot instead of invalidating it. Destructive changes place their pre-edit
recovery package in the same maintenance path and postpone orphan attachment
cleanup until that recovery succeeds.

The result is that Builder add/edit/delete requests commit the small schema JSON
and in-memory index immediately; Excel and recovery compression no longer sit
on the interactive request path.
