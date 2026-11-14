# Architecture
Static ES module frontend. `assets/app.js` controls view state and event delegation; domain logic is in `modules/`. `modules/storage.js` is the persistence boundary and is intended to be replaced with authenticated cloud APIs later. Research entities remain independent of campaign participation. Reports are snapshots, not live recalculations. No framework or build dependency.
