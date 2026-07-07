-- Task 28: dynamic language binding.
-- Stores the user's CURRENT Telegram interface language ('uk' | 'en' | 'ru'),
-- refreshed on every authenticated /api/me load from the HMAC-signed initData.
-- Read by the bot for out-of-band notifications (match found, new message,
-- referral bonus, retention nudges), where no initData exists to derive it from.
alter table users add column if not exists language_code text not null default 'uk';
