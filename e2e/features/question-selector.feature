# Question Selector (opencode-style) — BDD scenarios, Aug 2026.
#
# The scenarios below are implemented by:
#   - src/components/chat/QuestionSelector.spec.ts  (unit, vitest)
#   - src/composables/useQuestionSelector.spec.ts  (unit, vitest)
#   - e2e/question-selector.spec.ts                (Playwright, live DOM)
#
# British English throughout per repo convention.

Feature: Opencode-style answer selector at the chat composer
  When an agent issues the blocking question tool with options, the
  chat input area renders a selectable option list the operator can
  drive with arrow keys, the space bar and Enter, or with the mouse.

  Background:
    Given the agent has suspended on a question tool call with options
      | Yes | No | Maybe |
    And the long-poll diff has surfaced the pending question

  Scenario: Selector renders above the composer
    Then a vertical option list renders above the chat composer
    And the first option is highlighted as the current selection

  Scenario: Arrow keys move the highlight
    When the operator presses ArrowDown twice
    Then "Maybe" is the highlighted current selection
    When the operator presses ArrowUp
    Then "No" is the highlighted current selection

  Scenario: Enter submits the highlighted option (single select)
    When the operator moves the highlight onto "No" and presses Enter
    Then the frontend POSTs question-answer with answers ["No"]
    And the selector unmounts once the long-poll diff observes "answered"

  Scenario: Space toggles multiple options (allow_multiple)
    Given the question allows multiple selections
    When the operator toggles "Yes" and "Maybe" with the space bar
    And presses Enter
    Then the frontend POSTs question-answer with answers ["Yes", "Maybe"]

  Scenario: Other free-text answer
    Given the selector offers an "Other" row
    When the operator highlights "Other" and types "blue"
    And presses Enter
    Then the frontend POSTs question-answer with answers ["blue"]

  Scenario: Open question with no options falls back to free text
    Given the question carries no options
    Then the composer renders a free-text answer input bound to Enter

  Scenario: Escape dismisses the selector without answering
    When the operator presses Escape
    Then the selector collapses and the pending question remains unanswered

  Scenario: Multiple pending questions render together
    Given two question tool calls are pending
    Then two selector cards render stacked above the composer
    And each submits its own answers independently

  Scenario: Mouse click selects an option
    When the operator clicks the "Maybe" option row
    Then "Maybe" becomes the highlighted current selection
    And clicking Submit sends answers ["Maybe"]
