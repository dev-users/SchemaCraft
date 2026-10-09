# Alpha 34 seamless schema tabs

Alpha 34 completes the attached-tab composition for the separate Data Entry and
Builder Home workspaces.

## One visual surface

The schema tab and its open content no longer behave as two adjacent cards:

- The tab row draws the schema surface's upper boundary.
- The panel wrapper draws only the side and bottom boundaries.
- The active tab uses the exact same surface and border variables as the panel.
- A short extension beneath the active tab covers the boundary at their joint.
- The selected schema panel itself has no independent border, radius, shadow, or
  background.

Together these rules make the selected tab and its content appear as one shape,
while the inactive tabs remain visually separate above it.

## Smoother switching

The schema heading no longer adds a different tinted layer immediately below
the tab. A 160 ms opacity and vertical-settle animation softens panel changes;
it is disabled automatically when reduced motion is requested.

Data Entry and Builder remain independent cards with independent tab state.
Their content and behavior are otherwise unchanged.
