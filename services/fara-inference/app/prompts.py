"""
Prompt template manager with versioning for Fara inference service.

Provides stable, versioned prompt formats for the agent observation loop.
Prompt format must remain stable across model switches to preserve action history continuity.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any
import hashlib
import json


class PromptVersion(Enum):
    """Version history for prompt templates."""
    V1 = "v1"  # Initial observation loop prompt
    V2 = "v2"  # Added structured failure context


# Current active version - bump this when making breaking changes
CURRENT_PROMPT_VERSION = PromptVersion.V2


@dataclass
class ObservationPrompt:
    """
    Structured prompt for the agent observation loop.

    Contains all context needed for Fara to decide the next action:
    - Current screenshot
    - User's original goal
    - Relevant recent actions
    - Relevant approved user answers
    - Result of previous action
    - Concise failure message when action failed
    """
    version: PromptVersion
    goal: str
    screenshot_description: str
    recent_actions: list[dict[str, Any]]
    approved_user_answers: list[str]
    previous_action_result: dict[str, Any]
    failure_message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dictionary."""
        return {
            "version": self.version.value,
            "goal": self.goal,
            "screenshot_description": self.screenshot_description,
            "recent_actions": self.recent_actions,
            "approved_user_answers": self.approved_user_answers,
            "previous_action_result": self.previous_action_result,
            "failure_message": self.failure_message,
        }

    def to_prompt_string(self) -> str:
        """Render as a string prompt for the model."""
        parts = []

        parts.append("## Task Goal")
        parts.append(self.goal)
        parts.append("")

        parts.append("## Current Screenshot Description")
        parts.append(self.screenshot_description)
        parts.append("")

        if self.recent_actions:
            parts.append("## Recent Actions")
            for i, action in enumerate(self.recent_actions[-5:], 1):  # Last 5 actions
                action_str = f"{i}. {action.get('action_type', 'unknown')}: {action.get('description', '')}"
                if action.get('success'):
                    action_str += f" [Success: {action.get('result', '')}]"
                else:
                    action_str += f" [Failed: {action.get('error', 'unknown error')}]"
                parts.append(action_str)
            parts.append("")

        if self.approved_user_answers:
            parts.append("## Approved User Answers")
            for answer in self.approved_user_answers[-3:]:  # Last 3 answers
                parts.append(f"- {answer}")
            parts.append("")

        if self.previous_action_result:
            parts.append("## Previous Action Result")
            success = self.previous_action_result.get("success", False)
            if success:
                parts.append(f"Success: {self.previous_action_result.get('result', 'completed')}")
            else:
                parts.append(f"Failed: {self.previous_action_result.get('error', 'unknown error')}")
            parts.append("")

        if self.failure_message:
            parts.append("## Action Failure")
            parts.append(self.failure_message)
            parts.append("")

        parts.append("## Next Action")
        parts.append("Based on the current screenshot and task goal, determine the next action to take.")

        return "\n".join(parts)

    def get_checksum(self) -> str:
        """Get SHA256 checksum of the prompt content for caching/validation."""
        content = json.dumps(self.to_dict(), sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()


@dataclass
class PromptTemplate:
    """
    Versioned prompt template for Fara inference.

    Templates are immutable once created to ensure prompt stability
    across model versions and inference calls.
    """
    version: PromptVersion
    system_prompt: str
    observation_template: str
    created_at: datetime = field(default_factory=datetime.utcnow)

    @property
    def template_id(self) -> str:
        """Unique identifier for this template version."""
        return f"prompt-{self.version.value}"


class PromptTemplateManager:
    """
    Manages prompt templates with versioning support.

    Ensures prompt stability during a task and provides versioned
    prompts for debugging and reproducibility.
    """

    def __init__(self):
        self._templates: dict[PromptVersion, PromptTemplate] = {}
        self._active_version: PromptVersion = CURRENT_PROMPT_VERSION
        self._initialize_templates()

    def _initialize_templates(self) -> None:
        """Initialize all known prompt template versions."""
        self._templates[PromptVersion.V1] = PromptTemplate(
            version=PromptVersion.V1,
            system_prompt=self._get_v1_system_prompt(),
            observation_template=self._get_v1_observation_template(),
        )
        self._templates[PromptVersion.V2] = PromptTemplate(
            version=PromptVersion.V2,
            system_prompt=self._get_v2_system_prompt(),
            observation_template=self._get_v2_observation_template(),
        )

    def _get_v1_system_prompt(self) -> str:
        """V1 system prompt - initial version."""
        return """You are Fara, a browser automation agent. You see screenshots of the browser and take actions to complete user tasks.

You have access to these actions:
- click: Click at specified coordinates
- double_click: Double click at specified coordinates
- right_click: Right click at specified coordinates
- drag: Drag from one coordinate to another
- mouse_move: Move mouse to specified coordinates
- scroll: Scroll at specified coordinates
- key: Press a keyboard key
- visit_url: Navigate to a URL
- history_back: Go back in browser history
- screenshot: Take a screenshot
- wait: Wait for a specified duration
- ask_user_question: Ask the user for clarification or approval
- terminate: End the task
- pause_and_memorize_fact: Store information for later use

Always respond with a valid JSON object containing your action and arguments."""

    def _get_v1_observation_template(self) -> str:
        """V1 observation template - initial version."""
        return """## Current State
Goal: {goal}
Screenshot: {screenshot_description}

## Recent Actions
{recent_actions}

## Previous Action
{previous_action_result}

## Next Action
What would you like to do next?"""

    def _get_v2_system_prompt(self) -> str:
        """V2 system prompt - added failure context handling."""
        return """You are Fara, a browser automation agent. You see screenshots of the browser and take actions to complete user tasks.

You have access to these actions:
- click: Click at specified coordinates (left button)
- double_click: Double click at specified coordinates
- right_click: Right click at specified coordinates (context menu)
- drag: Drag from one coordinate to another
- mouse_move: Move mouse to specified coordinates
- scroll: Scroll at specified coordinates (positive=down, negative=up)
- key: Press a keyboard key
- visit_url: Navigate to a URL
- history_back: Go back in browser history
- screenshot: Take a screenshot of current state
- wait: Wait for a specified duration
- ask_user_question: Ask the user for clarification or approval
- terminate: End the task successfully
- pause_and_memorize_fact: Store information for later use

Important guidelines:
- Always analyze the screenshot carefully before taking action
- If an action fails, consider an alternative approach
- For text input, ensure the target field is focused first
- Coordinates are relative to the screenshot viewport
- When stuck, try a different approach or ask for user help

Respond with a valid JSON object containing your action and arguments."""

    def _get_v2_observation_template(self) -> str:
        """V2 observation template - enhanced failure context."""
        return """## Task Objective
{goal}

## Current Screenshot
{screenshot_description}

## Action History (Most Recent First)
{recent_actions}

## User Approved Answers
{approved_user_answers}

## Previous Action Outcome
{previous_action_result}

{failure_block}
## Next Action Decision
Based on the current screenshot and task objective, determine the next action.
If the previous action failed, consider an alternative approach.

Respond with a JSON object:
{{"action": "action_name", "arguments": {{"param": "value"}}}}"""

    def get_active_template(self) -> PromptTemplate:
        """Get the currently active prompt template."""
        return self._templates[self._active_version]

    def get_template(self, version: PromptVersion) -> PromptTemplate:
        """Get a specific template version."""
        if version not in self._templates:
            raise ValueError(f"Unknown prompt template version: {version}")
        return self._templates[version]

    def get_version(self) -> PromptVersion:
        """Get the current active prompt version."""
        return self._active_version

    def set_active_version(self, version: PromptVersion) -> None:
        """Set the active prompt template version."""
        if version not in self._templates:
            raise ValueError(f"Unknown prompt template version: {version}")
        self._active_version = version

    def build_observation_prompt(
        self,
        goal: str,
        screenshot_description: str,
        recent_actions: list[dict[str, Any]],
        approved_user_answers: list[str],
        previous_action_result: dict[str, Any],
        failure_message: str | None = None,
    ) -> ObservationPrompt:
        """
        Build a structured observation prompt for the agent.

        Args:
            goal: The user's original task goal
            screenshot_description: Description of current screenshot
            recent_actions: List of recent actions with their outcomes
            approved_user_answers: User answers that were approved
            previous_action_result: Result of the previous action
            failure_message: Optional failure message if action failed

        Returns:
            ObservationPrompt with all context for the model
        """
        return ObservationPrompt(
            version=self._active_version,
            goal=goal,
            screenshot_description=screenshot_description,
            recent_actions=recent_actions,
            approved_user_answers=approved_user_answers,
            previous_action_result=previous_action_result,
            failure_message=failure_message,
        )

    def render_prompt(
        self,
        goal: str,
        screenshot_description: str,
        recent_actions: list[dict[str, Any]],
        approved_user_answers: list[str],
        previous_action_result: dict[str, Any],
        failure_message: str | None = None,
    ) -> tuple[str, str]:
        """
        Render a complete prompt for inference.

        Returns:
            Tuple of (system_prompt, user_prompt) strings
        """
        template = self.get_active_template()

        # Format recent actions
        formatted_actions = self._format_recent_actions(recent_actions)

        # Format previous action result
        formatted_previous = self._format_previous_result(previous_action_result)

        # Format failure block if applicable
        failure_block = ""
        if failure_message:
            failure_block = f"## Previous Action Failed\n{failure_message}\n"

        # Format approved user answers
        formatted_answers = "\n".join(f"- {a}" for a in approved_user_answers[-3:]) if approved_user_answers else "None"

        # Render observation template
        user_prompt = template.observation_template.format(
            goal=goal,
            screenshot_description=screenshot_description,
            recent_actions=formatted_actions,
            approved_user_answers=formatted_answers,
            previous_action_result=formatted_previous,
            failure_block=failure_block,
        )

        return template.system_prompt, user_prompt

    def _format_recent_actions(self, actions: list[dict[str, Any]]) -> str:
        """Format recent actions for the prompt template."""
        if not actions:
            return "No actions taken yet."
        lines = []
        for action in actions[-5:]:  # Last 5 actions
            action_type = action.get("action_type", "unknown")
            description = action.get("description", "")
            success = action.get("success", False)
            result = action.get("result", "")
            error = action.get("error", "")

            line = f"- {action_type}: {description}"
            if success:
                line += f" [Success: {result}]"
            else:
                line += f" [Failed: {error}]"
            lines.append(line)
        return "\n".join(lines)

    def _format_previous_result(self, result: dict[str, Any]) -> str:
        """Format previous action result for the prompt template."""
        if not result:
            return "No previous action."
        success = result.get("success", False)
        if success:
            return f"Success: {result.get('result', 'Action completed')}"
        else:
            return f"Failed: {result.get('error', 'Unknown error')}"

    def list_versions(self) -> list[PromptVersion]:
        """List all available prompt template versions."""
        return list(self._templates.keys())


# Global prompt manager instance
_prompt_manager: PromptTemplateManager | None = None


def get_prompt_manager() -> PromptTemplateManager:
    """Get the global prompt manager instance (singleton)."""
    global _prompt_manager
    if _prompt_manager is None:
        _prompt_manager = PromptTemplateManager()
    return _prompt_manager
