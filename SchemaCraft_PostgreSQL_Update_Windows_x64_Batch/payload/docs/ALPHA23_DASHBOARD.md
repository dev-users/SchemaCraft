# Alpha 23 dashboard refinement

Alpha 23 keeps Home on the future-resizable 6 × 6 coordinate system while
making its current arrangement explicit:

- one full-width data card spans the first four logical rows;
- every active schema receives a bordered panel with its name, record,
  completion, and archive tags;
- each schema panel places a configurable graph on the right and its latest
  three opened records on the left;
- graph clicks open a field/type chooser; percentage bars support completion
  and populated-field ratios, while the semicircular gauge supports list and
  boolean distributions;
- Search, Import, and Export occupy the final two rows, with Open on the right
  and permanent history clearing on the left.

The search-results window now uses a viewport-bound outer container and an
inner bordered result panel. The table keeps horizontal and vertical scrolling
inside that panel. Final high-specificity scrollbar rules set a 16-pixel rail,
white track, and visible neutral thumb for the main page and nested scroll
areas.

The default-app creator preserves the bcrypt administrator hash for copies that
retain schemas. Choosing complete schema removal deletes both the data
workspace and `builder-auth.json`, so the new blank application initializes a
new administrator password.
