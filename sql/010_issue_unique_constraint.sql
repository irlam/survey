-- 010_issue_unique_constraint.sql
-- Fix race condition in issue number allocation
-- Run this migration to add a unique constraint on (plan_id, issue_no)

-- Renumber all issues sequentially per plan to ensure no duplicates
-- This uses MySQL user variables for efficient renumbering

-- Create a temp table with the new issue numbers
CREATE TEMPORARY TABLE _issue_renumber AS
SELECT 
    id,
    plan_id,
    (@row_number := IF(@current_plan = plan_id, @row_number + 1, 1)) AS new_issue_no,
    (@current_plan := plan_id) AS cp
FROM issues, (SELECT @row_number := 0, @current_plan := 0) AS vars
ORDER BY plan_id, id;

-- Update issues with new sequential numbers
UPDATE issues
INNER JOIN _issue_renumber ON issues.id = _issue_renumber.id
SET issues.issue_no = _issue_renumber.new_issue_no;

-- Clean up temp table
DROP TEMPORARY TABLE _issue_renumber;

-- Add the unique constraint to prevent future duplicates
ALTER TABLE issues 
ADD UNIQUE KEY uq_plan_issue_no (plan_id, issue_no);
