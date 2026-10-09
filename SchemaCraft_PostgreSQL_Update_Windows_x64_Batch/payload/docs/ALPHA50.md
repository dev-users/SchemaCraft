# Alpha 50

- Left-side layouts no longer have an extra outer surface. Action/status descriptions are hidden while their internal status hooks remain intact.
- Schema actions are ordered: add field, add category, save, discard, rename, archive, copy structure, delete, new schema, history. Backup creation is available in Application Settings.
- Destructive controls share colors, borders, corners and hover feedback.
- Repeated-card tabs have a white active surface. Only the active tab displays its delete control. Tab visits labels in sequence, inserting the active card’s delete control and fields after its label; the add control comes last. Enter opens a focused inactive tab. Inactive cards retain their saved data.
- Card and attachment removal use confirmation dialogs. Cancellation preserves content. Deleting a card focuses the remaining active tab, or the add control when no cards remain.
- Dropdowns can extend beyond the repeated-panel boundary. Date separators advance day to month and month to year; the year control retains focus. Checkbox names remain alongside their controls.
- The redundant Search setup panel is removed. Its filter chips remain with the filters. The search notes dialog begins with the archived-records option, used by schema and global search.
- General Builder navigation includes Appearance Conditions.

Validation: Python regressions, generated frontend syntax, browser DOM workflows for keyboard order, confirmations, preserved card data and relocated controls. Native Windows build not run in this Linux environment.
