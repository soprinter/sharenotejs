# Changelog

## [1.0.0]

### Changed

- Reworks difficulty aggregation to be exact: a note's total work is summed as
  `BigInt` instead of accumulated as floating-point estimates, hashing moves to
  `@noble/hashes` for portability across JavaScript runtimes, and the previous
  floating-point estimator entry points remain as deprecated aliases. (#PR)
