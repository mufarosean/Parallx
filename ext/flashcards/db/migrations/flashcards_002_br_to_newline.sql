-- Cards created before fcNormalizeCardText existed can carry literal HTML
-- line breaks ("1. MSE is smaller<br>2. Better approximation…") that the
-- renderer correctly escapes and therefore shows as text. Convert the
-- common <br> spellings to real newlines in place; new writes are
-- normalized at insert, so this is a one-time heal of old rows.
UPDATE fc_cards SET front = REPLACE(REPLACE(REPLACE(front, '<br />', char(10)), '<br/>', char(10)), '<br>', char(10)) WHERE front LIKE '%<br%';
UPDATE fc_cards SET back  = REPLACE(REPLACE(REPLACE(back,  '<br />', char(10)), '<br/>', char(10)), '<br>', char(10)) WHERE back  LIKE '%<br%';
