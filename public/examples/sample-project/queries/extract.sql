WITH source_events AS (
    SELECT
        e.event_id AS event_id,
        e.profile_id AS profile_id,
        e.event_time AS event_time,
        e.event_type AS event_type
    FROM raw_events AS e
    WHERE TD_TIME_RANGE(e.event_time, TD_SCHEDULED_TIME(), '-1d')
), source_profiles AS (
    SELECT
        p.profile_id AS profile_id,
        p.region AS region,
        p.profile_type AS profile_type
    FROM profile_attributes AS p
)
SELECT
    se.event_id AS event_id,
    se.profile_id AS profile_id,
    se.event_time AS event_time,
    se.event_type AS event_type,
    sp.region AS region,
    sp.profile_type AS profile_type
FROM source_events AS se
LEFT JOIN source_profiles AS sp
    ON se.profile_id = sp.profile_id
