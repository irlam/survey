-- 010_issue_unique_constraint.sql
-- Fix race condition in issue number allocation
-- Run this migration to add a unique constraint on (plan_id, issue_no)

-- First, fix any existing duplicate issue_no values within the same plan
-- This assigns new unique issue numbers to duplicates
UPDATE issues i1
JOIN (
    SELECT plan_id, issue_no, MIN(id) as min_id
    FROM issues
    GROUP BY plan_id, issue_no
    HAVING COUNT(*) > 1
) dup ON i1.plan_id = dup.plan_id AND i1.issue_no = dup.issue_no AND i1.id > dup.min_id
SET i1.issue_no = (
    SELECT COALESCE(MAX(issue_no), 0) + 1
    FROM issues i2
    WHERE i2.plan_id = i1.plan_id
);

-- Add the unique constraint to prevent future duplicates
ALTER TABLE issues 
ADD UNIQUE KEY uq_plan_issue_no (plan_id, issue_no);
