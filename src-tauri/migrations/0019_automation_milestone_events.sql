-- Emit only upward crossings; derived status remains a read model. Corrections
-- can make a milestone pending again and a later real crossing emits a new event.
CREATE TRIGGER milestone_financial_crossing AFTER INSERT ON finance_goal_contributions BEGIN
 INSERT INTO automation_events(id,trigger_type,entity_type,entity_id,created_at,depth)
 SELECT lower(hex(randomblob(16))),'milestone_completed','milestone',m.id,NEW.created_at,0
 FROM objective_milestones m JOIN finance_goals g ON g.id=m.financial_goal_id
 WHERE m.mode='financial_goal' AND g.id=NEW.goal_id
 AND g.initial_amount_cents+(SELECT coalesce(sum(amount_cents),0) FROM finance_goal_contributions WHERE goal_id=g.id)>=round(m.target_value*100)
 AND g.initial_amount_cents+(SELECT coalesce(sum(amount_cents),0) FROM finance_goal_contributions WHERE goal_id=g.id)-NEW.amount_cents<round(m.target_value*100);
END;
CREATE TRIGGER milestone_financial_correction AFTER UPDATE OF amount_cents ON finance_goal_contributions WHEN NEW.goal_id=OLD.goal_id AND NEW.amount_cents>OLD.amount_cents BEGIN
 INSERT INTO automation_events(id,trigger_type,entity_type,entity_id,created_at,depth)
 SELECT lower(hex(randomblob(16))),'milestone_completed','milestone',m.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),0
 FROM objective_milestones m JOIN finance_goals g ON g.id=m.financial_goal_id
 WHERE m.mode='financial_goal' AND g.id=NEW.goal_id
 AND g.initial_amount_cents+(SELECT coalesce(sum(amount_cents),0) FROM finance_goal_contributions WHERE goal_id=g.id)>=round(m.target_value*100)
 AND g.initial_amount_cents+(SELECT coalesce(sum(amount_cents),0) FROM finance_goal_contributions WHERE goal_id=g.id)-NEW.amount_cents+OLD.amount_cents<round(m.target_value*100);
END;
CREATE TRIGGER milestone_financial_initial AFTER UPDATE OF initial_amount_cents ON finance_goals WHEN NEW.initial_amount_cents>OLD.initial_amount_cents BEGIN
 INSERT INTO automation_events(id,trigger_type,entity_type,entity_id,created_at,depth)
 SELECT lower(hex(randomblob(16))),'milestone_completed','milestone',m.id,NEW.updated_at,0 FROM objective_milestones m
 WHERE m.mode='financial_goal' AND m.financial_goal_id=NEW.id
 AND NEW.initial_amount_cents+(SELECT coalesce(sum(amount_cents),0) FROM finance_goal_contributions WHERE goal_id=NEW.id)>=round(m.target_value*100)
 AND OLD.initial_amount_cents+(SELECT coalesce(sum(amount_cents),0) FROM finance_goal_contributions WHERE goal_id=NEW.id)<round(m.target_value*100);
END;
