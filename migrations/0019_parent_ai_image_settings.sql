ALTER TABLE parent_ai_service_settings ADD COLUMN image_base_url TEXT NOT NULL DEFAULT '';
ALTER TABLE parent_ai_service_settings ADD COLUMN image_api_key TEXT NOT NULL DEFAULT '';
ALTER TABLE parent_ai_service_settings ADD COLUMN image_model TEXT NOT NULL DEFAULT 'gpt-image-2';
ALTER TABLE parent_ai_service_settings ADD COLUMN image_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE parent_ai_service_settings ADD COLUMN image_size TEXT NOT NULL DEFAULT '1024x1024';
ALTER TABLE parent_ai_service_settings ADD COLUMN image_quality TEXT NOT NULL DEFAULT 'low';
ALTER TABLE parent_ai_service_settings ADD COLUMN image_format TEXT NOT NULL DEFAULT 'jpeg';
ALTER TABLE parent_ai_service_settings ADD COLUMN image_n INTEGER NOT NULL DEFAULT 1;
