# Alpha 24 workflow refinements

Alpha 24 preserves the 6 × 6 Home coordinate system while refining the cards
that occupy it. Every Home card can be collapsed. The Data card contains one
panel per schema; each panel has a history table, a percentage chart, and a
speed-gauge-style distribution chart on one row. Record history uses the
configured result title, keeps the record ID underneath, and offers Open and
Remove actions. The administrator-only Builder card reports general and
per-schema category/field totals and records the categories and fields changed
by each schema save. Search, Import, and Export history rows expose both schema
and note information.

Search and export selections now behave like editable chips. Clicking a chosen
result field removes it from the active schema search, general search, table
export, or profile export selection. Search-history clearing lives beside the
history table itself.

In Data Entry, the technical record ID remains read-only and copies to the
clipboard when clicked. Category headings include a small manual collapse
control. Moving focus into another category collapses the previous category,
while programmatic advancement from list and date inputs expands and focuses
the next real field rather than a category heading.

Excel inspection maps recognized columns as before and maps unrecognized
columns to Ignore. Ignore All provides a safe blank slate before an operator
maps only the columns that should be imported.

Builder changes include:

- Add Field is a sidebar action that first asks for its category.
- New checkbox-group fields are no longer offered; legacy schemas remain
  readable and editable without losing their saved type.
- A current-on-save user field is non-required, blank on record creation, and
  stamped with the current audit user only when an existing record is saved.
- A nested repeatable category can be placed directly after a selected field
  in its parent category. New unparented categories use the explicit placement
  selector rather than being silently appended.
- Repeatable cards accept a custom prefix such as `my_card`, producing
  `my_card 1`, `my_card 2`, and so on when no title field has a value.
- Attachment templates prioritize fields from the same repeatable card and
  make that same-card behavior explicit in the editor.
- Automatic-update sources include repeatable fields. A rule within the same
  category uses its current card; a rule using another repeatable category uses
  the first source card in document order that satisfies the rule.

The schema remains backward compatible. The new optional category properties
are `parent_field_id` and `card_name_prefix`; older nested categories without a
saved parent field continue to load and render at their legacy fallback
position.
