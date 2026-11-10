# performance-tooling Specification

## Purpose

Provides reproducible performance runs for representative parser, renderer, prepared-data CLI, package assembly, and offline package workflows. Stores immutable measurements with sample and environment context and produces comparable process-level regression and trend reports.

## Requirements

### Requirement: Stable benchmark case identity
The benchmark suite SHALL expose stable IDs for its twelve component cases through the `pnpm bench` entry point and its `--suite`, `--only`, and `--case` selection options.

#### Scenario: Cases are listed with stable IDs
- **WHEN** a user runs `pnpm bench --list`
- **THEN** the output lists every configured case with its case ID, suite, category, sample, and fixture ID/version

#### Scenario: Entry point selects cases
- **WHEN** a user selects cases with `--suite`, `--only`, or `--case`
- **THEN** the runner measures the matching cases and prints the run directory and a Markdown summary

### Requirement: Bounded independent benchmark runs
The benchmark runner SHALL apply explicit warmup duration, measurement duration, and minimum sample count policies and run measured forks in independent child processes.

#### Scenario: Benchmark run stays within configured budget
- **WHEN** a run starts with a valid time budget and fork count
- **THEN** each case records its warmup duration, measurement duration, minimum sample count, and fork configuration and measurement follows the configured duration and sample-count policy; an in-flight operation may complete after the duration boundary

#### Scenario: Forks represent independent processes
- **WHEN** a case is measured for multiple forks
- **THEN** each fork has a distinct child process and its own statistics, iteration count, and raw milliseconds per call

#### Scenario: Process startup fails
- **WHEN** a fork cannot start or exits without a valid result
- **THEN** the run records that fork failure with case and process context in `failures` and reports the case as failed

#### Scenario: Sub-millisecond operations use batched samples
- **WHEN** an operation completes faster than the one-millisecond sample target
- **THEN** the worker times several calls per sample, divides each sample by that call count, and the row records the count shared by the case's forks

### Requirement: Runtime resource observations
Each measured fork SHALL record one CPU-time interval in microseconds, process memory snapshots, and garbage collection observations, each with its sampling scope stated. Profiling modes SHALL be explicit and separate from normal resource sampling.

#### Scenario: Resource data accompanies timed measurements
- **WHEN** a fork completes measurement
- **THEN** its result includes the CPU-time interval and the memory and GC observations for that fork

#### Scenario: Resource sampling is unavailable
- **WHEN** an observation cannot be collected on the current runtime
- **THEN** the run identifies the unavailable observation and continues with timing data when timing succeeded

### Requirement: Immutable run records
The runner SHALL write a versioned JSON record for each run that preserves its environment, configuration, rows, skips, and failures.

#### Scenario: Run record is archived
- **WHEN** a benchmark run completes
- **THEN** a new run-directory record contains schemaVersion, runId, createdAt, environment, configuration, rows, skipped, and failures, and every run writes to a new run directory

#### Scenario: Row identifies its measurement source
- **WHEN** a case result is recorded
- **THEN** the row includes caseId, fixture id/version/parameters, category, name, sample, scope, per-fork measurements, and aggregate statistics

#### Scenario: Run includes failures and skips
- **WHEN** a case is skipped or fails
- **THEN** the run record names it in skipped or failures with an explicit reason and its recorded status

### Requirement: Compatible fork-level comparison
The comparison tool SHALL compare compatible run rows using fork medians as the independent observations and report regression thresholds and uncertainty.

#### Scenario: Comparable case has sufficient measurements
- **WHEN** baseline and candidate rows have matching case and fixture identity, fixture version and parameters, scope, Node and V8 versions, OS and CPU identity, Node options, runtime flags, build mode, and benchmark configuration
- **THEN** the comparison reports baseline and candidate fork medians, effect size, relative and absolute change, configured relative and absolute regression thresholds, and a deterministic process-level bootstrap confidence interval

#### Scenario: Case or environment is incompatible
- **WHEN** a row is missing or its sample, fixture parameters, timing scope, runtime environment, build mode, or benchmark configuration differs from its counterpart
- **THEN** the comparison labels the row missing or incompatible with the specific mismatch and records the verdict as `unclassified`

#### Scenario: Few forks or noisy measurements limit confidence
- **WHEN** the available independent forks or confidence interval cannot support a reliable conclusion
- **THEN** the report states that confidence is insufficient and records the verdict as an `improvement-warning` or `regression-warning`

#### Scenario: Regression threshold is crossed
- **WHEN** a compatible candidate is slower and both its relative change and absolute change exceed their configured thresholds
- **THEN** the report records `confirmed-regression` when the fork count and process-level interval support the result, records `regression-warning` otherwise, and an enabled fail-on-regression option returns a failing status only for a confirmed process-level regression

### Requirement: Environment-aware trend reports
The reporting tool SHALL present compatible runs as trends and retain links to per-run profiling artifacts.

#### Scenario: Trend report contains compatible history
- **WHEN** archived runs contain the same case, fixture parameters, and environment identity
- **THEN** the trend output groups them together by case and environment and includes their run IDs, fork-level summary, and linked CPU profile paths when present

#### Scenario: Trend history crosses environments
- **WHEN** archived runs contain different OS, CPU, Node/V8, flags, or benchmark configuration identities
- **THEN** the trend output keeps those measurements in separate marked series, including normal and profile build modes

#### Scenario: Trend output format is selected
- **WHEN** a user requests a report format
- **THEN** the reporting tool emits static HTML/SVG, Markdown, or JSON from archived run records

### Requirement: Representative benchmark coverage
The benchmark suite SHALL include synthetic scale cases, real component cases, CLI inspect/extract/render on prepared supported inputs, package assembly from prepared scene and PNG inputs, and generated local-package browser execution through `file://`.

#### Scenario: Synthetic scale coverage runs
- **WHEN** synthetic cases execute at configured increasing input sizes
- **THEN** each result records its fixture parameters and supports comparison of scaling across sizes

#### Scenario: Prepared data CLI and package assembly
- **WHEN** the CLI inspect, extract, and render cases run on prepared supported inputs and the package assembly case consumes a prepared scene and PNG inputs
- **THEN** the report distinguishes component, CLI, and package assembly timing and identifies each case's fixture and scope

#### Scenario: Generated package opens locally
- **WHEN** the generated menu package is opened by the browser through a `file://` URL
- **THEN** the browser case records whether its documented offline startup and menu interaction completed, alongside its timing measurements

### Requirement: Continuous benchmark reporting
The repository SHALL provide a fast synthetic CI run and scheduled or manually triggered full benchmark runs with downloadable records and job summaries.

#### Scenario: Pull request synthetic run
- **WHEN** the performance CI workflow runs for a pull request
- **THEN** it executes only the designated synthetic representative cases and publishes run artifacts and a job summary with the observed runner environment

#### Scenario: Scheduled or manual full run
- **WHEN** the performance CI workflow runs on its schedule or by manual dispatch
- **THEN** it makes the full available suite runnable and publishes run records, comparison output, and a job summary

#### Scenario: Baseline and candidate use one runner
- **WHEN** a CI comparison uses a pull request base revision
- **THEN** it measures base and candidate sequentially on the same runner with alternating order and records the observed environment for both
