# Performance Evaluation

Benchmark suite for measuring platform performance characteristics.

## Purpose

The performance evaluation suite measures:
- Screenshot-to-action latency
- End-to-end task latency
- Model inference latency (time to first token, total inference time)
- CDP relay throughput (messages/second, bandwidth)
- Memory usage per session
- CPU utilization under load
- GPU utilization for inference
- Session startup time
- Relay reconnection time

## Benchmarks

### Latency Benchmarks
- Cold start latency (session initialization)
- Hot path latency (per-action cycle)
- Screenshot capture latency
- Inference round-trip latency

### Throughput Benchmarks
- Concurrent sessions per orchestrator instance
- CDP relay message throughput
- Artifact upload/download throughput

### Resource Benchmarks
- Memory footprint per session
- GPU memory per inference request
- Network bandwidth per session

## Running Benchmarks

```bash
cd evals/performance
npm install
npm run benchmark
```

## Related

- [Reliability Tests](../reliability/README.md)
- [Browser Tasks Tests](../browser-tasks/README.md)
