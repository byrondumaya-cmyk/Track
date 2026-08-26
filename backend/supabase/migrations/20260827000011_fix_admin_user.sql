-- Fix the admin user created in the previous migration without an 'aud' column

DO $$
BEGIN
  -- Update any user missing the 'aud' column (which breaks Supabase dashboard)
  UPDATE auth.users 
  SET aud = 'authenticated' 
  WHERE aud IS NULL;
  
  -- Ensure provider_id is set in identities
  UPDATE auth.identities
  SET provider_id = user_id::text
  WHERE provider_id IS NULL OR provider_id = '';
END $$;
