def test_store_import_does_not_cycle_through_scheduler():
    from agent_os.store import AgentOSStore

    assert AgentOSStore is not None


def test_scheduler_remains_importable_after_store():
    from agent_os.store import AgentOSStore
    from agent_os.orchestration.scheduler import DurablePlanScheduler

    assert AgentOSStore is not None
    assert DurablePlanScheduler is not None
