# Makefile for managing Python dependencies with uv
#
# I built this because I got tired of juggling uv, pip, pyproject.toml,
# and requirements.txt by hand. This Makefile gives me fast, reproducible
# dependency management without forgetting to freeze, clean, or sync anything.
#
# Were I smarter I'd probably not have to do this. But, alas, I'm not.
#
# Key commands:
#
#   make -f Makefile add PACKAGE='pydantic[email]'
#       Install a new package, update pyproject.toml, and regenerate requirements.txt.
#
#   make -f Makefile upgrade
#       Upgrade all dependencies in pyproject.toml to latest allowed versions,
#       then regenerate requirements.txt.
#
#   make -f Makefile install
#       Install all dependencies as listed in pyproject.toml,
#       then regenerate requirements.txt.
#
#   make -f Makefile rebuild
#       Delete .venv and __pypackages__, recreate the virtualenv,
#       reinstall all packages from pyproject.toml,
#       then regenerate requirements.txt (cleaned of `-e` lines).
#
# This keeps everything in sync: pyproject.toml as the source of truth,
# requirements.txt as the deployable lockfile, and your environment reproducible.


# Upgrade all dependencies from pyproject.toml
upgrade:
	uv pip install --upgrade -r pyproject.toml
	$(MAKE) -f $(MAKEFILE_LIST) build

# Install exact versions from pyproject.toml
install:
	uv pip install -r pyproject.toml
	$(MAKE) -f $(MAKEFILE_LIST) build

# Rebuild environment from scratch
rebuild:
	rm -rf .venv __pypackages__
	python3 -m venv .venv
	source .venv/bin/activate && uv pip install -r pyproject.toml
	$(MAKE) -f $(MAKEFILE_LIST) build


# Add a new package and update pyproject.toml + requirements.txt
# Usage: make add PACKAGE=requests
add:
	uv add $(PACKAGE)
	$(MAKE) -f $(MAKEFILE_LIST) build

# Freeze and clean requirements.txt (removes editable installs)
build:
	uv pip freeze | grep -v '^-e' > requirements.txt
