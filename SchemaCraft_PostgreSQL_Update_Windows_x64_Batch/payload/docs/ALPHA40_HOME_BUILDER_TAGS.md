# Alpha 40 Builder dashboard refinement

Alpha 40 aligns Builder's Home dashboard statistics with the visual language of
Data Entry and clarifies the two actions available from a Builder schema tab.

## Builder tab behavior

- Selecting a closed Builder tab opens its dashboard panel and stays on Home.
- Selecting that same tab again, once active, opens the corresponding Builder
  workspace.
- The general fields/categories tab follows the same rule and opens the general
  Builder scope only on its second, active selection.

## Builder-wide statistics

The overview above the tabs now uses the same independent statistic tiles as
Data Entry. It includes schemas, total/main/repeated/independent/parented/
general/schema-specific categories, and the equivalent field-location/source
statistics.

## Per-tab statistics

The statistics section keeps the requested category-first and field-second
order, but every value is now rendered as a compact schema statistic tag. The
general tab replaces “from general” with the number of fields without a
category. Charts and history retain their Alpha 39 layout and behavior.
