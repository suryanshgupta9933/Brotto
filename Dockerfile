# Brotto orchestrator — self-host image.
#
# Build context is the repo ROOT: the only pyproject.toml is at the root
# and it points [tool.setuptools.packages.find] at
# services/brotto-orchestrator/src.
#
# This image is thin on purpose. Playwright is a dev dependency
# (requirements-dev.txt, the `dev` dependency-group) and is NOT installed
# here — the product path is the Chrome extension driving the user's own
# browser over CDP, so the server never launches a browser. Dropping the
# `playwright install chromium --with-deps` this file used to run is most
# of the size, and it is the difference between a 1GB image and a small one.

FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

# The build toolchain stays in this stage. The runtime stage gets binary
# wheels and no compiler.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip wheel --wheel-dir /wheels -r requirements.txt

COPY pyproject.toml ./
COPY services/brotto-orchestrator/src ./services/brotto-orchestrator/src
RUN pip wheel --wheel-dir /wheels --no-deps .


FROM python:3.12-slim AS runtime

ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    BROTTO_ENV=prod \
    BROTTO_SESSIONS_DIR=/data/sessions \
    BROTTO_USER_POLICY_DIR=/data/user_policies \
    BROTTO_USER_MODEL_DIR=/data/user_models

# BROTTO_ENV=prod is set here rather than left to the operator to
# remember, and it is a cost control, not a formality: the default is
# dev, and dev pre-seeds AGENT_MODEL=minimax:MiniMax-M3 and propagates
# ANTHROPIC_AUTH_TOKEN. A user who connects without pasting a key would
# then spend the operator's model credits, and it fails silently and
# looks like success.
#
# Unbuffered output means the container log is the only place stdout
# exists, so there is no log file to rotate inside the container.

RUN useradd --system --create-home --uid 10001 brotto

COPY requirements.txt ./
COPY --from=builder /wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links=/wheels \
        -r requirements.txt /wheels/brotto_orchestrator-*.whl \
 && rm -rf /wheels /requirements.txt \
 && mkdir -p /data/sessions /data/user_policies /data/user_models \
 && chown -R brotto:brotto /data

USER brotto
WORKDIR /home/brotto

EXPOSE 8000

# /health is unauthenticated by design — a load balancer or the Docker
# healthcheck has to be able to reach it — and returns 200 plus the
# resolved model name.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request as u,sys; sys.exit(0 if u.urlopen('http://127.0.0.1:8000/health',timeout=2).status==200 else 1)"

# No model API key is baked in, and none should be: image layers are
# recoverable even after a later layer is deleted. Under BYOK the model
# key comes from the user's extension. A self-hoster supplies only
# AGENT_SECRET — see docs/architecture/deployment.md.
CMD ["brotto", "--host", "0.0.0.0", "--port", "8000"]
