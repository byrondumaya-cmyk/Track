


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."check_checkpoint_proximity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  gps_point   GEOGRAPHY;
  cp          RECORD;
  dist_m      DOUBLE PRECISION;
  recent_visit BIGINT;
BEGIN
  -- Build the GPS point from the new record
  gps_point := ST_SetSRID(
    ST_MakePoint(NEW.lon, NEW.lat),
    4326
  )::geography;

  -- Loop through all active checkpoints
  FOR cp IN
    SELECT id, name, location, radius_m
    FROM   public.checkpoints
    WHERE  is_active = TRUE
  LOOP
    dist_m := ST_Distance(gps_point, cp.location);

    IF dist_m <= cp.radius_m THEN
      -- Debounce: skip if same device visited this checkpoint
      -- in the last 30 minutes
      SELECT id INTO recent_visit
      FROM   public.checkpoint_visits
      WHERE  checkpoint_id = cp.id
        AND  device_id     = NEW.device_id
        AND  visited_at    > NOW() - INTERVAL '30 minutes'
      LIMIT 1;

      IF recent_visit IS NULL THEN
        INSERT INTO public.checkpoint_visits
          (checkpoint_id, device_id, gps_record_id, visited_at, distance_m)
        VALUES
          (cp.id, NEW.device_id, NEW.id, NEW.timestamp, dist_m);

        RAISE NOTICE '[GEOFENCE] Device % visited checkpoint "%" (dist: %.1fm)',
          NEW.device_id, cp.name, dist_m;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_checkpoint_proximity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_checkpoint_visit_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  cp_name TEXT;
  events_enabled BOOLEAN;
BEGIN
  SELECT d.track_events_enabled
  INTO events_enabled
  FROM public.devices d
  WHERE d.id = NEW.device_id;

  IF COALESCE(events_enabled, TRUE) = FALSE THEN
    RETURN NEW;
  END IF;

  SELECT name INTO cp_name
  FROM public.checkpoints
  WHERE id = NEW.checkpoint_id;

  INSERT INTO public.system_events (device_id, event_type, payload, timestamp)
  VALUES (
    NEW.device_id,
    'checkpoint_visit',
    jsonb_build_object(
      'checkpoint_id', NEW.checkpoint_id,
      'checkpoint_name', cp_name,
      'gps_record_id', NEW.gps_record_id,
      'distance_m', NEW.distance_m,
      'visited_at', NEW.visited_at
    ),
    NEW.visited_at
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_checkpoint_visit_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_stale_devices_offline"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.device_status
  SET status = 'offline'
  WHERE
    status = 'online'
    AND last_seen < NOW() - INTERVAL '3 minutes';
END;
$$;


ALTER FUNCTION "public"."mark_stale_devices_offline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_device_wifi"("p_device_uuid" "uuid", "p_ssid" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.devices
  SET wifi_networks = (
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    FROM jsonb_array_elements(wifi_networks) AS elem
    WHERE elem->>'ssid' != p_ssid
  )
  WHERE id = p_device_uuid;
END;
$$;


ALTER FUNCTION "public"."remove_device_wifi"("p_device_uuid" "uuid", "p_ssid" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."remove_device_wifi"("p_device_uuid" "uuid", "p_ssid" "text") IS 'Removes a WiFi credential by SSID for a given device.';



CREATE OR REPLACE FUNCTION "public"."update_device_status_on_gps"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.device_status (
    device_id,
    last_seen,
    last_lat,
    last_lon,
    last_speed,
    battery_pct,
    rssi_dbm,
    lte_connected,
    gps_fix,
    status
  )
  VALUES (
    NEW.device_id,
    NEW.timestamp,
    NEW.lat,
    NEW.lon,
    NEW.speed_kmh,
    NEW.battery_pct,
    NEW.rssi_dbm,
    NEW.lte_connected,
    NEW.gps_fix,
    'online'
  )
  ON CONFLICT (device_id) DO UPDATE SET
    last_seen = EXCLUDED.last_seen,
    last_lat = EXCLUDED.last_lat,
    last_lon = EXCLUDED.last_lon,
    last_speed = EXCLUDED.last_speed,
    battery_pct = EXCLUDED.battery_pct,
    rssi_dbm = EXCLUDED.rssi_dbm,
    lte_connected = EXCLUDED.lte_connected,
    gps_fix = EXCLUDED.gps_fix,
    status = 'online';

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_device_status_on_gps"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_device_wifi"("p_device_uuid" "uuid", "p_ssid" "text", "p_password" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  existing_networks JSONB;
  new_entry         JSONB;
BEGIN
  SELECT wifi_networks INTO existing_networks
  FROM public.devices WHERE id = p_device_uuid;

  -- Remove any existing entry with the same SSID first
  existing_networks := (
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    FROM jsonb_array_elements(existing_networks) AS elem
    WHERE elem->>'ssid' != p_ssid
  );

  new_entry := jsonb_build_object(
    'ssid',     p_ssid,
    'password', p_password,
    'added_at', NOW()::TEXT
  );

  UPDATE public.devices
  SET wifi_networks = existing_networks || jsonb_build_array(new_entry)
  WHERE id = p_device_uuid;
END;
$$;


ALTER FUNCTION "public"."upsert_device_wifi"("p_device_uuid" "uuid", "p_ssid" "text", "p_password" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."upsert_device_wifi"("p_device_uuid" "uuid", "p_ssid" "text", "p_password" "text") IS 'Adds or updates a WiFi credential for a device. Prevents duplicate SSIDs.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."checkpoint_visits" (
    "id" bigint NOT NULL,
    "checkpoint_id" "uuid",
    "device_id" "uuid",
    "gps_record_id" bigint,
    "visited_at" timestamp with time zone NOT NULL,
    "distance_m" double precision
);


ALTER TABLE "public"."checkpoint_visits" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."checkpoint_visits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."checkpoint_visits_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."checkpoint_visits_id_seq" OWNED BY "public"."checkpoint_visits"."id";



CREATE TABLE IF NOT EXISTS "public"."checkpoints" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "lat" double precision NOT NULL,
    "lon" double precision NOT NULL,
    "radius_m" integer DEFAULT 75 NOT NULL,
    "route_order" integer,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "location" "public"."geography"(Point,4326) GENERATED ALWAYS AS (("public"."st_setsrid"("public"."st_makepoint"("lon", "lat"), 4326))::"public"."geography") STORED
);


ALTER TABLE "public"."checkpoints" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."daily_checkpoint_compliance" AS
 SELECT "cv"."device_id",
    "date"(("cv"."visited_at" AT TIME ZONE 'Asia/Manila'::"text")) AS "date_ph",
    "cp"."id" AS "checkpoint_id",
    "cp"."name" AS "checkpoint_name",
    "cp"."route_order",
    "min"("cv"."visited_at") AS "first_visit",
    "min"("cv"."distance_m") AS "closest_m",
    "count"(*) AS "visit_count"
   FROM ("public"."checkpoint_visits" "cv"
     JOIN "public"."checkpoints" "cp" ON (("cp"."id" = "cv"."checkpoint_id")))
  GROUP BY "cv"."device_id", ("date"(("cv"."visited_at" AT TIME ZONE 'Asia/Manila'::"text"))), "cp"."id", "cp"."name", "cp"."route_order"
  ORDER BY ("date"(("cv"."visited_at" AT TIME ZONE 'Asia/Manila'::"text"))) DESC, "cp"."route_order";


ALTER VIEW "public"."daily_checkpoint_compliance" OWNER TO "postgres";


COMMENT ON VIEW "public"."daily_checkpoint_compliance" IS 'Daily summary of which checkpoints each device visited, with first-visit time and closest approach distance.';



CREATE TABLE IF NOT EXISTS "public"."device_status" (
    "device_id" "uuid" NOT NULL,
    "last_seen" timestamp with time zone,
    "last_lat" double precision,
    "last_lon" double precision,
    "last_speed" real,
    "battery_pct" smallint,
    "rssi_dbm" smallint,
    "lte_connected" boolean,
    "gps_fix" boolean,
    "fw_version" "text",
    "reboot_count" integer DEFAULT 0,
    "status" "text" DEFAULT 'unknown'::"text",
    "wifi_connected" boolean DEFAULT false NOT NULL,
    "wifi_ssid" "text"
);


ALTER TABLE "public"."device_status" OWNER TO "postgres";


COMMENT ON COLUMN "public"."device_status"."wifi_connected" IS 'Whether device is currently on a WiFi network.';



COMMENT ON COLUMN "public"."device_status"."wifi_ssid" IS 'SSID of the currently connected WiFi network (NULL if LTE only).';



CREATE TABLE IF NOT EXISTS "public"."devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "device_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "api_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true,
    "wifi_networks" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "apn" "text",
    "sim_number" "text",
    "sim_carrier" "text",
    "track_history_enabled" boolean DEFAULT true NOT NULL,
    "track_events_enabled" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."devices" OWNER TO "postgres";


COMMENT ON COLUMN "public"."devices"."wifi_networks" IS 'Cloud-stored WiFi credential list. Array of {ssid, password, added_at}. ESP32 fetches this on boot to auto-provision WiFi.';



COMMENT ON COLUMN "public"."devices"."apn" IS 'Cellular APN used for LTE connection (e.g. internet, internet.globe.com.ph). Fetched by ESP32 on boot.';



COMMENT ON COLUMN "public"."devices"."sim_number" IS 'Phone number of the inserted SIM card.';



COMMENT ON COLUMN "public"."devices"."sim_carrier" IS 'Carrier name (e.g. Smart PH, Globe PH).';



COMMENT ON COLUMN "public"."devices"."track_history_enabled" IS 'When FALSE, ingest skips inserting gps_records for this device.';



COMMENT ON COLUMN "public"."devices"."track_events_enabled" IS 'When FALSE, ingest and checkpoint triggers skip writing system_events for this device.';



CREATE TABLE IF NOT EXISTS "public"."gps_records" (
    "id" bigint NOT NULL,
    "device_id" "uuid",
    "timestamp" timestamp with time zone NOT NULL,
    "location" "public"."geography"(Point,4326),
    "lat" double precision NOT NULL,
    "lon" double precision NOT NULL,
    "speed_kmh" real,
    "heading_deg" real,
    "hdop" real,
    "satellites" smallint,
    "battery_mv" integer,
    "battery_pct" smallint,
    "rssi_dbm" smallint,
    "lte_connected" boolean DEFAULT true,
    "gps_fix" boolean DEFAULT true,
    "sequence_no" bigint,
    "uploaded_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "wifi_connected" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."gps_records" OWNER TO "postgres";


COMMENT ON COLUMN "public"."gps_records"."wifi_connected" IS 'TRUE = uploaded via WiFi, FALSE = uploaded via LTE modem.';



CREATE SEQUENCE IF NOT EXISTS "public"."gps_records_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."gps_records_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."gps_records_id_seq" OWNED BY "public"."gps_records"."id";



CREATE TABLE IF NOT EXISTS "public"."system_events" (
    "id" bigint NOT NULL,
    "device_id" "uuid",
    "event_type" "text" NOT NULL,
    "payload" "jsonb",
    "timestamp" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."system_events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."system_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."system_events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."system_events_id_seq" OWNED BY "public"."system_events"."id";



ALTER TABLE ONLY "public"."checkpoint_visits" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."checkpoint_visits_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."gps_records" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."gps_records_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."system_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."system_events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."checkpoint_visits"
    ADD CONSTRAINT "checkpoint_visits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checkpoints"
    ADD CONSTRAINT "checkpoints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."device_status"
    ADD CONSTRAINT "device_status_pkey" PRIMARY KEY ("device_id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_device_id_key" UNIQUE ("device_id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gps_records"
    ADD CONSTRAINT "gps_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_events"
    ADD CONSTRAINT "system_events_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_checkpoint_visits_checkpoint" ON "public"."checkpoint_visits" USING "btree" ("checkpoint_id", "visited_at" DESC);



CREATE INDEX "idx_checkpoint_visits_device_time" ON "public"."checkpoint_visits" USING "btree" ("device_id", "visited_at" DESC);



CREATE INDEX "idx_checkpoints_location" ON "public"."checkpoints" USING "gist" ("location");



CREATE INDEX "idx_gps_records_device_time" ON "public"."gps_records" USING "btree" ("device_id", "timestamp" DESC);



CREATE INDEX "idx_gps_records_location" ON "public"."gps_records" USING "gist" ("location");



CREATE OR REPLACE TRIGGER "tr_check_checkpoints" AFTER INSERT ON "public"."gps_records" FOR EACH ROW EXECUTE FUNCTION "public"."check_checkpoint_proximity"();



CREATE OR REPLACE TRIGGER "tr_log_checkpoint_visit_event" AFTER INSERT ON "public"."checkpoint_visits" FOR EACH ROW EXECUTE FUNCTION "public"."log_checkpoint_visit_event"();



CREATE OR REPLACE TRIGGER "tr_update_device_status" AFTER INSERT ON "public"."gps_records" FOR EACH ROW EXECUTE FUNCTION "public"."update_device_status_on_gps"();



ALTER TABLE ONLY "public"."checkpoint_visits"
    ADD CONSTRAINT "checkpoint_visits_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."checkpoints"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checkpoint_visits"
    ADD CONSTRAINT "checkpoint_visits_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id");



ALTER TABLE ONLY "public"."checkpoint_visits"
    ADD CONSTRAINT "checkpoint_visits_gps_record_id_fkey" FOREIGN KEY ("gps_record_id") REFERENCES "public"."gps_records"("id");



ALTER TABLE ONLY "public"."device_status"
    ADD CONSTRAINT "device_status_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id");



ALTER TABLE ONLY "public"."gps_records"
    ADD CONSTRAINT "gps_records_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id");



ALTER TABLE ONLY "public"."system_events"
    ADD CONSTRAINT "system_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id");



CREATE POLICY "Allow authenticated read access" ON "public"."device_status" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow authenticated read access" ON "public"."devices" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow authenticated read access" ON "public"."gps_records" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow authenticated read access" ON "public"."system_events" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."checkpoint_visits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "checkpoint_visits_delete_auth" ON "public"."checkpoint_visits" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "checkpoint_visits_read_auth" ON "public"."checkpoint_visits" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "checkpoint_visits_write_service" ON "public"."checkpoint_visits" FOR INSERT TO "service_role" WITH CHECK (true);



ALTER TABLE "public"."checkpoints" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "checkpoints_read_auth" ON "public"."checkpoints" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "checkpoints_write_auth" ON "public"."checkpoints" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "checkpoints_write_service" ON "public"."checkpoints" TO "service_role" USING (true);



ALTER TABLE "public"."device_status" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "device_status_select_auth" ON "public"."device_status" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "device_status_upsert_service" ON "public"."device_status" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."devices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devices_update_auth" ON "public"."devices" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."gps_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gps_records_delete_auth" ON "public"."gps_records" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "gps_records_insert_service" ON "public"."gps_records" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "gps_records_select_auth" ON "public"."gps_records" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."system_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_events_delete_auth" ON "public"."system_events" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "system_events_insert_service" ON "public"."system_events" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "system_events_select_auth" ON "public"."system_events" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "visits_read_auth" ON "public"."checkpoint_visits" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "visits_write_service" ON "public"."checkpoint_visits" TO "service_role" USING (true);



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."check_checkpoint_proximity"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_checkpoint_proximity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_checkpoint_proximity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_checkpoint_visit_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_checkpoint_visit_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_checkpoint_visit_event"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_stale_devices_offline"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_stale_devices_offline"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_stale_devices_offline"() TO "service_role";



GRANT ALL ON FUNCTION "public"."remove_device_wifi"("p_device_uuid" "uuid", "p_ssid" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."remove_device_wifi"("p_device_uuid" "uuid", "p_ssid" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_device_wifi"("p_device_uuid" "uuid", "p_ssid" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_device_status_on_gps"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_device_status_on_gps"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_device_status_on_gps"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_device_wifi"("p_device_uuid" "uuid", "p_ssid" "text", "p_password" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_device_wifi"("p_device_uuid" "uuid", "p_ssid" "text", "p_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_device_wifi"("p_device_uuid" "uuid", "p_ssid" "text", "p_password" "text") TO "service_role";



GRANT ALL ON TABLE "public"."checkpoint_visits" TO "anon";
GRANT ALL ON TABLE "public"."checkpoint_visits" TO "authenticated";
GRANT ALL ON TABLE "public"."checkpoint_visits" TO "service_role";



GRANT ALL ON SEQUENCE "public"."checkpoint_visits_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."checkpoint_visits_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."checkpoint_visits_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."checkpoints" TO "anon";
GRANT ALL ON TABLE "public"."checkpoints" TO "authenticated";
GRANT ALL ON TABLE "public"."checkpoints" TO "service_role";



GRANT ALL ON TABLE "public"."daily_checkpoint_compliance" TO "anon";
GRANT ALL ON TABLE "public"."daily_checkpoint_compliance" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_checkpoint_compliance" TO "service_role";



GRANT ALL ON TABLE "public"."device_status" TO "anon";
GRANT ALL ON TABLE "public"."device_status" TO "authenticated";
GRANT ALL ON TABLE "public"."device_status" TO "service_role";



GRANT ALL ON TABLE "public"."devices" TO "anon";
GRANT ALL ON TABLE "public"."devices" TO "authenticated";
GRANT ALL ON TABLE "public"."devices" TO "service_role";



GRANT ALL ON TABLE "public"."gps_records" TO "anon";
GRANT ALL ON TABLE "public"."gps_records" TO "authenticated";
GRANT ALL ON TABLE "public"."gps_records" TO "service_role";



GRANT ALL ON SEQUENCE "public"."gps_records_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."gps_records_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."gps_records_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."system_events" TO "anon";
GRANT ALL ON TABLE "public"."system_events" TO "authenticated";
GRANT ALL ON TABLE "public"."system_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."system_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."system_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."system_events_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







