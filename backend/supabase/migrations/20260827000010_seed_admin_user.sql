-- Enable pgcrypto for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  uid UUID := gen_random_uuid();
  user_email TEXT := 'mlgualiaga@gmail.com';
  user_password TEXT := 'admin@menrolgu-aliaga';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = user_email) THEN
    -- Create the user
    INSERT INTO auth.users (
      id, 
      instance_id, 
      email, 
      encrypted_password, 
      email_confirmed_at, 
      created_at, 
      updated_at, 
      raw_app_meta_data, 
      raw_user_meta_data, 
      is_super_admin, 
      role
    ) VALUES (
      uid, 
      '00000000-0000-0000-0000-000000000000', 
      user_email, 
      crypt(user_password, gen_salt('bf')), 
      now(), 
      now(), 
      now(), 
      '{"provider":"email","providers":["email"]}', 
      '{}', 
      false, 
      'authenticated'
    );
    
    -- Create the identity mapping
    INSERT INTO auth.identities (
      id, 
      user_id, 
      provider_id,
      identity_data, 
      provider, 
      last_sign_in_at, 
      created_at, 
      updated_at
    ) VALUES (
      gen_random_uuid(), 
      uid, 
      uid::text,
      format('{"sub":"%s","email":"%s"}', uid::text, user_email)::jsonb, 
      'email', 
      now(), 
      now(), 
      now()
    );
  END IF;
END $$;
