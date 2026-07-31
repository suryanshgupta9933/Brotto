"""
Continuous batching configuration for vLLM inference.

Provides configuration presets for different deployment scenarios.
"""

from dataclasses import dataclass
from enum import Enum


class BatchingProfile(Enum):
    """Batching configuration profiles."""
    DEVELOPMENT = "development"    # Single request, no batching
    STANDARD = "standard"          # Default batching settings
    HIGH_THROUGHPUT = "high_throughput"  # Maximize throughput
    LOW_LATENCY = "low_latency"    # Minimize latency


@dataclass
class BatchingConfig:
    """
    Continuous batching configuration for vLLM.

    These settings control how vLLM batches inference requests.
    """
    # Maximum number of concurrent sequences in a batch
    max_num_seqs: int
    # Maximum number of concurrent sequences
    max_num_concurrent_limit: int
    # Preempted sequences are decoded in the next iteration
    enable_chunked_prefill: bool
    # Number of iterations to run beam search
    num_beams: int
    # Enable prefix caching
    enable_prefix_caching: bool
    # GPU memory utilization target
    gpu_memory_utilization: float
    # Maximum number of blocks in KV cache
    max_num_batched_tokens: int
    # Schedule policy: "guaranteed_proportional" or "fl_proportional"
    schedule_policy: str


# Configuration presets
BATCHING_CONFIGS = {
    BatchingProfile.DEVELOPMENT: BatchingConfig(
        max_num_seqs=1,
        max_num_concurrent_limit=1,
        enable_chunked_prefill=False,
        num_beams=1,
        enable_prefix_caching=False,
        gpu_memory_utilization=0.85,
        max_num_batched_tokens=8192,
        schedule_policy="guaranteed_proportional",
    ),
    BatchingProfile.STANDARD: BatchingConfig(
        max_num_seqs=256,
        max_num_concurrent_limit=256,
        enable_chunked_prefill=True,
        num_beams=1,
        enable_prefix_caching=True,
        gpu_memory_utilization=0.90,
        max_num_batched_tokens=8192,
        schedule_policy="guaranteed_proportional",
    ),
    BatchingProfile.HIGH_THROUGHPUT: BatchingConfig(
        max_num_seqs=512,
        max_num_concurrent_limit=512,
        enable_chunked_prefill=True,
        num_beams=1,
        enable_prefix_caching=True,
        gpu_memory_utilization=0.92,
        max_num_batched_tokens=16384,
        schedule_policy="fl_proportional",
    ),
    BatchingProfile.LOW_LATENCY: BatchingConfig(
        max_num_seqs=32,
        max_num_concurrent_limit=32,
        enable_chunked_prefill=True,
        num_beams=1,
        enable_prefix_caching=True,
        gpu_memory_utilization=0.85,
        max_num_batched_tokens=4096,
        schedule_policy="guaranteed_proportional",
    ),
}


def get_batching_config(profile: BatchingProfile) -> BatchingConfig:
    """Get batching configuration for a profile."""
    return BATCHING_CONFIGS[profile]


def generate_vllm_args(config: BatchingConfig) -> list[str]:
    """
    Generate vLLM command-line arguments from batching config.

    Returns list of argument strings that can be passed to vLLM server.
    """
    return [
        f"--max-num-seqs={config.max_num_seqs}",
        f"--max-num-concurrent-limit={config.max_num_concurrent_limit}",
        f"--enable-chunked-prefill={str(config.enable_chunked_prefill).lower()}",
        f"--num-beams={config.num_beams}",
        f"--enable-prefix-caching={str(config.enable_prefix_caching).lower()}",
        f"--gpu-memory-utilization={config.gpu_memory_utilization}",
        f"--max-num-batched-tokens={config.max_num_batched_tokens}",
        f"--schedule-policy={config.schedule_policy}",
    ]
