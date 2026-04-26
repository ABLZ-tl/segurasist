# SegurAsist Infrastructure - Makefile
# Usage: make <target> ENV=<dev|staging|prod>

SHELL := /bin/bash
ENV ?= dev
ENV_DIR := envs/$(ENV)
TF := terraform
TFLINT := tflint
TFDOCS := terraform-docs

VALID_ENVS := dev staging prod

.PHONY: help check-env init plan apply destroy fmt fmt-check validate lint docs clean refresh output

help:
	@echo "SegurAsist Infrastructure - Make targets"
	@echo ""
	@echo "Usage: make <target> ENV=<dev|staging|prod>"
	@echo ""
	@echo "Targets:"
	@echo "  init           Initialize terraform backend for ENV"
	@echo "  plan           Run terraform plan for ENV"
	@echo "  apply          Run terraform apply for ENV (interactive confirm)"
	@echo "  destroy        Destroy ENV resources (requires DESTROY=YES)"
	@echo "  refresh        Refresh terraform state for ENV"
	@echo "  output         Show terraform outputs for ENV"
	@echo "  fmt            Format all .tf files"
	@echo "  fmt-check      Check formatting without changes"
	@echo "  validate       Run terraform validate for ENV"
	@echo "  lint           Run tflint over modules + ENV"
	@echo "  docs           Regenerate terraform-docs in modules"
	@echo "  clean          Remove .terraform/ and plan files"

check-env:
	@if [[ ! " $(VALID_ENVS) " =~ " $(ENV) " ]]; then \
		echo "ERROR: ENV must be one of: $(VALID_ENVS)"; \
		exit 1; \
	fi
	@if [[ ! -d "$(ENV_DIR)" ]]; then \
		echo "ERROR: $(ENV_DIR) does not exist"; \
		exit 1; \
	fi

init: check-env
	@cd $(ENV_DIR) && $(TF) init -reconfigure

plan: check-env
	@cd $(ENV_DIR) && $(TF) plan -out=tfplan.out

apply: check-env
	@cd $(ENV_DIR) && $(TF) apply tfplan.out || $(TF) apply

destroy: check-env
	@if [[ "$(DESTROY)" != "YES" ]]; then \
		echo "ERROR: destroy requires DESTROY=YES"; \
		echo "  make destroy ENV=$(ENV) DESTROY=YES"; \
		exit 1; \
	fi
	@echo ""
	@echo "About to DESTROY all resources in $(ENV)."
	@read -p "Type the env name ($(ENV)) to confirm: " confirm; \
	if [[ "$$confirm" == "$(ENV)" ]]; then \
		cd $(ENV_DIR) && $(TF) destroy; \
	else \
		echo "Confirmation failed; aborting."; \
		exit 1; \
	fi

refresh: check-env
	@cd $(ENV_DIR) && $(TF) refresh

output: check-env
	@cd $(ENV_DIR) && $(TF) output

fmt:
	@$(TF) fmt -recursive .

fmt-check:
	@$(TF) fmt -recursive -check -diff .

validate: check-env
	@cd $(ENV_DIR) && $(TF) init -backend=false >/dev/null && $(TF) validate

lint:
	@$(TFLINT) --init
	@for dir in modules/*/ ; do \
		echo "Linting $$dir"; \
		(cd "$$dir" && $(TFLINT) --config=$(PWD)/.tflint.hcl) || exit 1; \
	done
	@echo "Linting $(ENV_DIR)"
	@cd $(ENV_DIR) && $(TFLINT) --config=$(PWD)/.tflint.hcl

docs:
	@for dir in modules/*/ ; do \
		echo "Generating docs for $$dir"; \
		$(TFDOCS) markdown table --config $(PWD)/terraform-docs.yml --output-file README.md --output-mode inject "$$dir"; \
	done

clean:
	@find . -type d -name ".terraform" -prune -exec rm -rf {} +
	@find . -type f -name "tfplan.out" -delete
	@find . -type f -name "*.tfplan" -delete
	@echo "Cleaned .terraform/ and tfplan files."
