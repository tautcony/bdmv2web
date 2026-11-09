# Spec Delta

## ADDED Requirements

### Requirement: Media output size reporting

The system SHALL measure and report the output directory size before and after each menu-loop or linear media export. The system SHALL monitor individual `maxAssetBytes` limits during encoding.

#### Scenario: Menu-loop export reports output size

- **WHEN** a menu-loop media export completes
- **THEN** its result reports the output directory size before and after the export

#### Scenario: Linear export reports output size

- **WHEN** a linear media export completes
- **THEN** its result reports the output directory size before and after the export

#### Scenario: Asset exceeds its limit

- **WHEN** one encoded asset exceeds `maxAssetBytes`
- **THEN** that media job stops with `MEDIA_ASSET_BUDGET_EXCEEDED`
