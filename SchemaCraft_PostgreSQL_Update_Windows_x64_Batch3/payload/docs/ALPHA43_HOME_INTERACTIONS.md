# Alpha 43 Home statistic interactions

Alpha 43 extends the Home dashboard without changing its established layout.

## Custom Data statistics

Each selected schema and field now exposes its live values in a multi-select
control. At least one value is required when the statistic is saved. The card
counts matching profiles across the selected schemas, and a profile is counted
once even when a selected value appears in multiple rows of a repeatable field.
Existing saved statistics without value filters retain their former calculation
behavior until edited.

## Data schema tabs

Data tabs now mirror Builder tabs: selecting an inactive tab reveals its panel;
selecting that active tab again opens the matching Data Entry page.

## Builder overview

Each pie segment is a button. Its first state shows repeated or independent;
selecting it switches to main or parented, and selecting it again returns to the
original measure. The number, pie proportion, accessible description, and
pressed state update together.

## General field structure

The general-fields tab now shows one explicit `within category / without
category` partition. The repeated duplicate `without category` tags were
removed; the remaining category-kind and parentage rows describe only fields
that belong to categories.
