-- Written by hand: drizzle-kit does not manage extensions, and every table
-- after this one may use them.

-- Case-insensitive text, so Ali@Example.com and ali@example.com are one email.
CREATE EXTENSION IF NOT EXISTS citext;
