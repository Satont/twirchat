# GPUI Best Practices - Rule Sections

## Section Overview

| Priority | Prefix    | Section             | Description                             |
| -------- | --------- | ------------------- | --------------------------------------- |
| 1        | `core-`   | Core Concepts       | Ownership, Entity, Context fundamentals |
| 2        | `render-` | Rendering           | Element composition, Render traits      |
| 3        | `state-`  | State Management    | notify(), observe, subscribe patterns   |
| 4        | `event-`  | Event Handling      | Actions, focus, listeners               |
| 5        | `async-`  | Async & Concurrency | Tasks, debounce, background work        |
| 6        | `style-`  | Styling             | Flexbox, theme, elevation               |
| 7        | `comp-`   | Components          | Stateless patterns, traits, dialogs     |
| 8        | `anti-`   | Anti-patterns       | Common mistakes to avoid                |
| 9        | `test-`   | Testing             | Test framework and patterns             |

## Rules by Section

### Core Concepts (CRITICAL)

- `core-ownership-model` - GPUI's single ownership architecture
- `core-entity-operations` - read/update/observe/subscribe usage
- `core-weak-entity` - Breaking circular references
- `core-context-types` - App, Context<T>, AsyncApp differences

### Rendering (CRITICAL)

- `render-render-vs-renderonce` - Stateful vs stateless components
- `render-element-composition` - Building element trees
- `render-conditional` - .when() and .when_some() patterns
- `render-builder-pattern` - Fluent component APIs

### State Management (HIGH)

- `state-notify` - Triggering re-renders

### Event Handling (HIGH)

- `event-actions` - Keyboard shortcuts and actions
- `event-listener` - cx.listener() for view-bound handlers
- `event-focus` - FocusHandle and key contexts

### Async & Concurrency (MEDIUM-HIGH)

- `async-task-lifecycle` - Store or detach tasks
- `async-debounce` - Debounce and throttle patterns
- `async-background-spawn` - CPU-intensive work offloading
- `async-weak-entity` - Safe async state access

### Styling (MEDIUM)

- `style-flexbox` - Layout with h_flex/v_flex
- `style-theme-colors` - Theme-aware color usage
- `style-elevation` - Layered surface styling

### Components (MEDIUM)

- `comp-stateless` - RenderOnce with #[derive(IntoElement)]
- `comp-traits` - Disableable, Selectable, Sizable
- `comp-focus-ring` - Accessibility focus indicators
- `comp-dialog` - WindowExt dialog management

### Anti-patterns (CRITICAL)

- `anti-silent-error` - Never discard errors silently
- `anti-drop-task` - Never drop tasks without handling
- `anti-drop-subscription` - Always detach subscriptions
- `anti-circular-reference` - Use WeakEntity for cycles
- `anti-missing-notify` - Always notify after state changes
- `anti-unwrap` - Avoid unwrap(), use ? or handling

### Testing (HIGH)

- `test-basics` - Test framework fundamentals
- `test-run-until-parked` - Async test synchronization
- `test-events` - Event and notification testing
- `test-ui` - UI interaction testing
