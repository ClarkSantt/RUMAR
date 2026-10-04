-- Keep the already-applied 0004 checksum stable. A food's nutrient base can
-- be a serving or volume, while calculations always use an explicit gram base.
ALTER TABLE foods ADD COLUMN base_grams_equivalent REAL NOT NULL DEFAULT 100
 CHECK(base_grams_equivalent>0);
UPDATE foods SET base_grams_equivalent=base_amount WHERE base_unit='g';
