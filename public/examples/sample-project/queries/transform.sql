WITH event_rollup AS (
    SELECT
        e.profile_id AS profile_id,
        e.region AS region,
        COUNT(*) AS event_count,
        MAX(e.event_time) AS last_event_time
    FROM workflow_extracted_events AS e
    GROUP BY
        e.profile_id,
        e.region
), profile_rollup AS (
    SELECT
        p.profile_id AS profile_id,
        p.profile_type AS profile_type
    FROM profile_attributes AS p
)
SELECT
    er.profile_id AS profile_id,
    er.region AS region,
    pr.profile_type AS profile_type,
    er.event_count AS event_count,
    er.last_event_time AS last_event_time
FROM event_rollup AS er
INNER JOIN profile_rollup AS pr
    ON er.profile_id = pr.profile_id
