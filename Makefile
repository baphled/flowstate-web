.PHONY: ai-commit check-ai-attribution list-ai-commits

#
# AI Attribution — shared across all FlowState repos
#

ai-commit: ## Create AI-attributed commit (FILE=/path/to/msg.txt AI_MODEL=model)
	@if [ -z "$(FILE)" ]; then \
		echo "Usage:"; \
		echo "  AI_MODEL=<model> make ai-commit FILE=/path/to/commit-msg.txt"; \
		echo ""; \
		echo "Required: AI_MODEL must be set (OPENCODE=1 is set automatically)"; \
		echo ""; \
		echo "Create your commit message file:"; \
		echo "  cat > /tmp/commit.txt << 'EOF'"; \
		echo "  feat(scope): short description"; \
		echo "  "; \
		echo "  Optional longer explanation..."; \
		echo "  EOF"; \
		echo ""; \
		echo "  AI_MODEL=<model> make ai-commit FILE=/tmp/commit.txt"; \
		echo ""; \
		exit 1; \
	fi
	@OPENCODE=1 bash scripts/ai-commit.sh "$(FILE)" "$(NO_VERIFY)"

check-ai-attribution: ## Check latest commit for AI attribution
	@echo "Checking latest commit for AI attribution..."
	@git log -1 --pretty=%B | grep "AI-Generated-By:" || \
		echo "Warning: No AI attribution found in latest commit"

list-ai-commits: ## List all AI-generated commits
	@echo "AI-Generated Commits:"
	@git log --all --grep="AI-Generated-By:" --oneline
