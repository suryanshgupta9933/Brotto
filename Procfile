# PYTHONPATH, not a `pip install .`: Heroku's Python buildpack runs the
# postinstall of a requirements.txt app but never calls a hand-written
# `heroku-postbuild` from the build phase, so the `brotto` console script in
# [project.scripts] never lands and the Procfile dies with exit 127. The source
# tree is already in the slug — pointing at it is the whole fix.
#
# BROTTO_ENV=prod inline rather than as a config var: a config var can be unset
# and the failure is silent (dev-mode env defaults reappear and the dyno spends
# the operator's key instead of the extension's BYOK one).
web: BROTTO_ENV=prod PYTHONPATH=/app/services/brotto-orchestrator/src python -m brotto_orchestrator.cli --host 0.0.0.0 --port $PORT