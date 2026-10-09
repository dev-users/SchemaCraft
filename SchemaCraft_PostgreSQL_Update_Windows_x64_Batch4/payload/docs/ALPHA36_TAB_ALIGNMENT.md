# Alpha 36 rounded tab alignment

Alpha 36 refines the geometry of the borderless schema tabs used independently
by the Data Entry and Builder Home workspaces.

## Edge alignment

The tab strip now has zero inline padding. Because the Home interface is RTL,
the first schema tab therefore begins exactly at the right edge of the schema
content surface. The narrow-layout rule no longer adds a five-pixel inset.

## Rounded geometry

- Schema tabs use 15-pixel upper corner radii.
- The schema surface uses 22-pixel lower corner radii.
- Its far upper corner uses an 18-pixel logical radius while the corner beneath
  the first RTL tab remains square, preserving the joined silhouette.
- General statistic cards use 18-pixel corners.
- Data Entry and Builder workspace surfaces use 28-pixel desktop corners and
  22-pixel narrow-layout corners.

## Visible tab bridge

Horizontal scrolling requires the tab row to clip vertical overflow. The row
now reserves eight pixels of bottom padding inside that clipping boundary. The
active tab's nine-pixel background extension occupies this reserved space, so
the tab-to-content bridge remains visible without affecting horizontal scroll.
