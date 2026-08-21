from worktracker_agent.mcp.server import MCP_INSTRUCTIONS, mcp


def test_server_declares_the_single_project_contract():
    instructions = " ".join(MCP_INSTRUCTIONS.split())

    assert mcp.instructions == MCP_INSTRUCTIONS
    assert "one installation project" in instructions
    assert "Do not ask the user to choose a project" in instructions
    assert "list_projects returns the sole installation project" in instructions
