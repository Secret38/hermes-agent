"""Read-only learning evidence and full notes stay tied to real profile data."""
from agent.learning_graph import build_learning_graph
from agent.learning_mutations import node_detail
from hermes_constants import reset_hermes_home_override, set_hermes_home_override


def test_graph_explains_declared_and_lexical_edges_from_real_files(tmp_path):
    from tools.skill_usage import record_created

    home = tmp_path / "evidence"
    (home / "memories").mkdir(parents=True)
    (home / "memories" / "MEMORY.md").write_text("Use report-builder for weekly report output", encoding="utf-8")
    token = set_hermes_home_override(home)
    try:
        for name, related in (("report-builder", "[reviewer]"), ("reviewer", "[]")):
            folder = home / "skills" / name
            folder.mkdir(parents=True)
            (folder / "SKILL.md").write_text(f"---\nname: {name}\ndescription: Example\nrelated_skills: {related}\n---\nBody", encoding="utf-8")
            record_created(name, agent_created=False)
        graph = build_learning_graph()
        declared = next(edge for edge in graph["edges"] if edge["kind"] == "declared")
        assert declared["declared_by"] == ["report-builder"]
        assert {declared["source"], declared["target"]} == {"report-builder", "reviewer"}
        lexical = next(edge for edge in graph["edges"] if edge["kind"] == "lexical")
        assert lexical["target"] == "report-builder"
        assert lexical["shared_terms"] == ["builder", "report"]
        assert lexical["name_match"] is True
        assert "confidence" not in lexical
    finally:
        reset_hermes_home_override(token)


def test_full_note_reads_follow_content_identity_and_profile_a_b_a(tmp_path):
    body = "Long note\n" + "content " * 200 + "end of full note"
    homes = [tmp_path / name for name in ("A", "B")]
    for home in homes:
        (home / "memories").mkdir(parents=True)
    (homes[0] / "memories" / "MEMORY.md").write_text("First\n§\n" + body, encoding="utf-8")
    (homes[1] / "memories" / "MEMORY.md").write_text("Different private note", encoding="utf-8")
    token = set_hermes_home_override(homes[0])
    try:
        graph = build_learning_graph()
        node = next(n for n in graph["nodes"] if n["label"] == "Long note")
        assert len(graph["memory"][1]["body"]) < len(body)
        assert node_detail(node["id"])["content"] == body
    finally:
        reset_hermes_home_override(token)
    token = set_hermes_home_override(homes[1])
    try:
        assert node_detail(node["id"])["ok"] is False
    finally:
        reset_hermes_home_override(token)
    token = set_hermes_home_override(homes[0])
    try:
        (homes[0] / "memories" / "MEMORY.md").write_text(body, encoding="utf-8")
        assert node_detail(node["id"])["content"] == body
        (homes[0] / "memories" / "MEMORY.md").write_text("Changed", encoding="utf-8")
        assert node_detail(node["id"])["ok"] is False
    finally:
        reset_hermes_home_override(token)
