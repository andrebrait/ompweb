# Graph Report - ompweb-all-fixes-g_90n3q6  (2026-09-10)

## Corpus Check
- 392 files · ~581,022 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3191 nodes · 7579 edges · 170 communities (141 shown, 20 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 120 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d3d7e70e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- agents-service.ts
- usage-db.ts
- MessageView.tsx
- useAgentSession.ts
- session-files.ts
- [...path]/route.ts
- AppUpdateDialog.tsx
- Changelog
- useI18n
- ModelsConfig.tsx
- lucide-react
- useAgentSession.rpc.test.mjs
- self-update.ts
- model-catalog.ts
- worktree.ts
- mcp/route.ts
- AppShell.tsx
- react
- ChatInput.tsx
- apiErrorResponse
- omp-web.js
- sessions/[id]/route.ts
- windows-service.ts
- ChatWindow.tsx
- useTheme.ts
- session-reader.ts
- FileViewer.tsx
- ompweb
- archive.ts
- withBasePath
- SessionSidebar.tsx
- AgentSessionWrapper
- plugins/route.ts
- omp-web-update-worker.js
- FileExplorer.tsx
- FileIcons.tsx
- rpc-manager.ts
- models-config.ts
- ComposerPanels.tsx
- SettingsConfig.tsx
- package.json
- types.ts
- settings-config.ts
- Key Design Decisions & Traps
- session-file-references-core.ts
- SessionSidebar-rows.tsx
- TrayApplication
- rpc-process.ts
- file-access.ts
- project-registry.ts
- skills-service.ts
- PluginsConfig.tsx
- skill-updates.ts
- subagent-history.ts
- invalidateSessionListCache
- chat-transcript-plan.ts
- markdown.ts
- app-update/route.ts
- models/route.ts
- ChatInput-draft-attachments.ts
- bounded-form-data.ts
- field.tsx
- rpc-utility.ts
- file-index/route.ts
- provider-usage.ts
- search/route.ts
- omp-web-options.js
- git-changes.ts
- pi-types.ts
- useAgentSession
- RpcProcess
- subagent-types.ts
- tool-preset-preference.ts
- web-slash-commands.ts
- dependencies
- compilerOptions
- web-auth.ts
- ProviderUsageBar.tsx
- MessageView-diff-view.tsx
- jiti
- omp-web UI/UX 全面重塑设计：温暖人文（Warm Paper）
- useUiScale.ts
- skill-lock.ts
- image-attachments.ts
- network-addresses.js
- useFontSize.ts
- npm-update.ts
- omp-web-launchd.js
- AgentMessage
- ansi.ts
- withStorageNamespace
- generate-release-notes.js
- draft-store.ts
- transcript.ts
- scripts
- directory-browser.ts
- AppShell-layout.tsx
- ompweb — Product & Architecture Contract
- file-fuzzy.ts
- workspace-memory.ts
- devDependencies
- model-roles.ts
- translate
- BranchNavigator.tsx
- ChatInput.test.mjs
- useAgentSession-notices.ts
- file-links.ts
- process-lifecycle.js
- SyntaxHighlightedCode.tsx
- http-dispatcher.ts
- macos-launchd.mts
- terminal-input.ts
- ExtensionDialog.tsx
- message-update-coalescer.ts
- startRpcSession
- Props
- RightPanel.tsx
- omp-web-tray.ps1
- attachOutput
- TodoList.tsx
- updates.ts
- login/[provider]/route.ts
- node-version.test.mjs
- ChatInput-model-picker.tsx
- Worktrees in ompweb
- ompweb 里的 Worktree
- model-scope.ts
- security-headers.test.mjs
- Contributing to omp-web
- chat-transcript-plan.test.mjs
- reconcile-guard.ts
- port-availability.js
- Release Checklist
- rpc-process-runtime.test.mjs
- omp-web-service.ps1
- initial-navigation.ts
- session-change-bus.ts
- subagent-types.test.mjs
- thinking-levels.test.mjs
- next.config.ts
- browser-notifications.ts
- project-registry.test.mjs
- usage-db.test.mjs
- bin
- logout/[provider]/route.ts
- FileExplorer.test.mjs
- tray.csproj
- file-access.test.mjs
- file-paths.test.mjs
- npm-update.test.mjs
- mcp-config.test.mjs
- updates.test.mjs
- reconcile-guard.test.mjs
- sse-lifecycle.test.mjs
- usage-rates.test.mjs
- repository
- postcss.config.mjs
- tailwindcss
- install-tray.ps1
- eslint.config.mjs
- toast-stub.mjs

## God Nodes (most connected - your core abstractions)
1. `useI18n()` - 147 edges
2. `react` - 85 edges
3. `withBasePath()` - 79 edges
4. `isRecord()` - 74 edges
5. `jiti` - 64 edges
6. `useAgentSession()` - 51 edges
7. `apiErrorResponse()` - 40 edges
8. `lucide-react` - 37 edges
9. `AgentSessionWrapper` - 36 edges
10. `ChatInput` - 34 edges

## Surprising Connections (you probably didn't know these)
- `GET()` --calls--> `readModelsConfig()`  [EXTRACTED]
  app/api/auth/all-providers/route.ts → lib/omp/models-config.ts
- `GET()` --calls--> `apiErrorResponse()`  [EXTRACTED]
  app/api/auth/api-key/[provider]/route.ts → lib/api-utils.ts
- `Props` --references--> `SessionTreeNode`  [EXTRACTED]
  components/BranchNavigator.tsx → lib/types.ts
- `TreeNodeProps` --references--> `SessionTreeNode`  [EXTRACTED]
  components/BranchNavigator.tsx → lib/types.ts
- `ProcessDetailsGroup()` --calls--> `useI18n()`  [EXTRACTED]
  components/ChatWindow.tsx → lib/i18n/index.tsx

## Import Cycles
- 3-file cycle: `lib/file-access.ts -> lib/session-reader.ts -> lib/worktree.ts -> lib/file-access.ts`

## Communities (170 total, 20 thin omitted)

### Community 0 - "agents-service.ts"
Cohesion: 0.07
Nodes (60): allowedCwd(), allowedProjectScope(), DELETE(), dynamic, GET(), parseScope(), POST(), PUT() (+52 more)

### Community 1 - "usage-db.ts"
Cohesion: 0.07
Nodes (53): dynamic, GET(), ModelsFileConfig, readModelsConfig(), forEachFileLineSync(), getUsageDatabase(), getUsageDbPath(), getUsageReportFromDb() (+45 more)

### Community 2 - "MessageView.tsx"
Cohesion: 0.07
Nodes (51): AssistantMessageView(), CompactionFileMetadata(), CompactionMessageView(), CustomMessageView(), getResultDiff(), formatCustomType(), formatMessageSize(), formatTime() (+43 more)

### Community 3 - "useAgentSession.ts"
Cohesion: 0.07
Nodes (55): TodoListProps, AGENT_STATE_RECONCILE_MS, AgentEvent, AgentPhase, AgentStateResponse, AttachedImage, BASH_STATE_RECONCILE_MS, buildOutgoingPrompt() (+47 more)

### Community 4 - "session-files.ts"
Cohesion: 0.07
Nodes (54): cleanSessionTitle(), collectSessionFiles(), countMessageMarkers(), CURRENT_SESSION_VERSION, decodeJsonStringFragment(), degradeMissingBlobImage(), deriveSessionStatus(), extractFirstDisplayMessageFromPrefix() (+46 more)

### Community 5 - "[...path]/route.ts"
Cohesion: 0.07
Nodes (46): createFileBodyStream(), escapeHtml(), EXT_TO_LANGUAGE, FILE_REQUEST_TYPE_SET, FILE_REQUEST_TYPES, filePathFromSegments(), FileRequestType, GET() (+38 more)

### Community 6 - "AppUpdateDialog.tsx"
Cohesion: 0.07
Nodes (34): APP_UPDATE_STEP_BY_STAGE, APP_UPDATE_STEPS, AppUpdateDialog(), AppUpdateDialogProps, AppUpdateReleaseNotes, getAppUpdateStepIndex(), getAppUpdateVersionTransition(), isSafeReleaseUrl() (+26 more)

### Community 7 - "Changelog"
Cohesion: 0.04
Nodes (47): Changelog, Contributors, Contributors, Contributors, Contributors, Fixes & Improvements, Fixes & Improvements, Fixes & Improvements (+39 more)

### Community 8 - "useI18n"
Cohesion: 0.08
Nodes (40): ComposerModeStatus(), ModelErrorBanner(), LanguageSwitcher(), ModelsConfig(), ThinkingEditor(), PluginsConfigSurface(), ResourceList(), SearchResultsList() (+32 more)

### Community 9 - "ModelsConfig.tsx"
Cohesion: 0.09
Nodes (38): ModelDetail(), OAuthDetail(), AddProviderPicker(), AddProviderPickerProps, ApiKeyDetail(), CodeText(), ModelsConfigSurface(), ProviderIcon() (+30 more)

### Community 10 - "lucide-react"
Cohesion: 0.06
Nodes (35): AgentInfo, AgentsConfig(), fillForm(), AgentsResponse, fileStem(), inputStyle, nativeSelectStyle, shorten() (+27 more)

### Community 11 - "useAgentSession.rpc.test.mjs"
Cohesion: 0.07
Nodes (24): activeRenderers, assistantMsg(), callsTo(), docTarget, FakeEventSource, fetchStub(), jiti, jsonResponse() (+16 more)

### Community 12 - "self-update.ts"
Cohesion: 0.16
Nodes (38): commitAppUpdate(), abortPreparedSelfUpdate(), acknowledgeSelfUpdate(), armSelfUpdateLauncher(), atomicWrite(), attemptsDir(), cleanupStaleSelfUpdate(), commitSelfUpdate() (+30 more)

### Community 13 - "model-catalog.ts"
Cohesion: 0.09
Nodes (35): CatalogCache, dynamic, fetchCatalog(), GET(), loadCatalog(), baseUrlMatches(), cleanString(), CompleteModelCatalogCost (+27 more)

### Community 14 - "worktree.ts"
Cohesion: 0.15
Nodes (30): normalizeCwd(), POST(), GET(), POST(), worktreeErrorCode(), allowFileRoot(), normalizeForComparison(), projectIdentityKey() (+22 more)

### Community 15 - "mcp/route.ts"
Cohesion: 0.12
Nodes (35): allowedCwd(), DELETE(), dynamic, GET(), mcpErrorResponse(), mergeMcpServers(), POST(), PUT() (+27 more)

### Community 16 - "AppShell.tsx"
Cohesion: 0.10
Nodes (32): APP_UPDATE_COMPLETED_RELOAD_MS, APP_UPDATE_ERROR_MAX_LENGTH, APP_UPDATE_POLL_MS, APP_UPDATE_PREPARING_MIN_MS, APP_UPDATE_STOPPING_POLL_MS, APP_UPDATE_TIMEOUT_MS, APP_UPDATE_VISIBLE_STAGE_MIN_MS, AppUpdateTransportError (+24 more)

### Community 17 - "react"
Cohesion: 0.08
Nodes (23): ClickableImage(), ClickableImageProps, ImageLightbox(), jiti, MarkdownBody(), MarkdownBodyProps, jiti, renderMarkdown() (+15 more)

### Community 18 - "ChatInput.tsx"
Cohesion: 0.12
Nodes (31): QueuedActionButton(), ChatInput, revokeImagePreview(), getMenuBoundary(), menuDropStyle(), MenuPlacement, compareModelOptions(), COMPOSER_MODELS_STORAGE_KEY (+23 more)

### Community 19 - "apiErrorResponse"
Cohesion: 0.13
Nodes (24): dynamic, GET(), commandErrorResponse(), GET(), POST(), POST(), POST(), POST() (+16 more)

### Community 20 - "omp-web.js"
Cohesion: 0.10
Nodes (32): acknowledgeAndStartRestart(), acknowledgeArm(), acknowledgeRestartRequest(), atomicWrite(), browserUrl, crypto, fs, { getAccessibleAddresses, getBrowserUrl, formatAddressBanner, isLoopbackHost } (+24 more)

### Community 21 - "sessions/[id]/route.ts"
Cohesion: 0.14
Nodes (31): contextErrorResponse(), GET(), branchPreviewForEntry(), DELETE(), GET(), projectTreeForResponse(), sessionsErrorResponse(), buildSessionTree() (+23 more)

### Community 22 - "windows-service.ts"
Cohesion: 0.18
Nodes (32): dynamic, GET(), POST(), WindowsServiceRequestBody, DEFAULT_WEB_SERVICE_CONFIG, execFileAsync, getAppVersion(), getRepoRoot() (+24 more)

### Community 23 - "ChatWindow.tsx"
Cohesion: 0.10
Nodes (26): ChatInputHandle, useMessageRefs(), ChatWindow(), ExtensionCustomRequest, ExtensionStatusBar(), ExtensionWidgets(), getUserInputText(), phaseLabel() (+18 more)

### Community 24 - "useTheme.ts"
Cohesion: 0.10
Nodes (29): CommandPalette, Props, relativeTime(), ALL_OPTIONS, ThemeOption, ThemeSwitcher(), ALL_THEMES, applyDomTheme() (+21 more)

### Community 25 - "session-reader.ts"
Cohesion: 0.14
Nodes (28): GET(), containsBlobRef(), LoadedSession, MAX_SESSION_LOAD_BYTES, resolveBlobRefsInEntries(), base64ImageInfo(), compactionUiMessage(), entryToUiMessage() (+20 more)

### Community 26 - "FileViewer.tsx"
Cohesion: 0.12
Nodes (28): AudioViewer(), closestSourceLine(), DiffLine, diffLines(), DiffView(), DISPLAY_MODE_LABEL_KEYS, DisplayMode, DocumentViewer() (+20 more)

### Community 27 - "ompweb"
Cohesion: 0.06
Nodes (29): Checks, CLI Options, Development, Environment Variables, Features, CLI オプション, ompweb, クイックスタート (+21 more)

### Community 28 - "archive.ts"
Cohesion: 0.11
Nodes (22): GET(), POST(), runtime, isoSessionTimestamp(), POST(), ArchivedSessionRecord, archiveRootPath(), collectArchives() (+14 more)

### Community 29 - "withBasePath"
Cohesion: 0.09
Nodes (21): manifest(), OmpRuntimeVersion(), BrowseResponse, DirectoryEntry, DirectoryPicker(), isWindowsDriveRoot(), loadDirectories(), Props (+13 more)

### Community 30 - "SessionSidebar.tsx"
Cohesion: 0.15
Nodes (24): buildSessionTree(), displayCwd(), EMPTY_PROJECT_SET, EXPANDED_PROJECTS_STORAGE_KEY, loadExpandedProjects(), loadUnreadSessionIds(), normalizeProjectKey(), projectLabel() (+16 more)

### Community 31 - "AgentSessionWrapper"
Cohesion: 0.17
Nodes (5): AgentSessionWrapper, notifyRunningChange(), patchEstimatedTokensAfter(), toImageContents(), WebRpcError

### Community 32 - "plugins/route.ts"
Cohesion: 0.12
Nodes (28): dynamic, emptyCounts(), GET(), manifestResources(), OmpMarketplaceEntry, OmpMarketplacePlugin, OmpNpmPlugin, OmpPluginList (+20 more)

### Community 33 - "omp-web-update-worker.js"
Cohesion: 0.12
Nodes (27): abortFile(), atomicWrite(), attemptId, cp, from, fs, isLaunchdActive(), isTrayActive() (+19 more)

### Community 34 - "FileExplorer.tsx"
Cohesion: 0.12
Nodes (25): ExplorerRowProps, fetchEntries(), fetchGitStatus(), FileEntry, FileExplorer, FileNode, FlatRow, flattenVisibleRows() (+17 more)

### Community 36 - "rpc-manager.ts"
Cohesion: 0.09
Nodes (25): dynamic, GET(), SESSION_LIST_HEADERS, AgentEvent, buildSessionSpawnArgs(), CompactionResultLike, DROPPED_TOOL_NAMES, EventListener (+17 more)

### Community 37 - "models-config.ts"
Cohesion: 0.13
Nodes (23): dynamic, GET(), PUT(), dynamic, errorMessage(), POST(), carryComments(), isPlainRecord() (+15 more)

### Community 38 - "ComposerPanels.tsx"
Cohesion: 0.14
Nodes (20): ComposerPanels(), loadCollapsed(), NOTE: omp reports context as a single total (tokens/window/percent) — there, saveCollapsed(), SUBAGENT_STATE_KEYS, SubagentActivityLine(), SUBAGENTS_COLLAPSED_STORAGE_KEY, SubagentsPanel() (+12 more)

### Community 39 - "SettingsConfig.tsx"
Cohesion: 0.09
Nodes (25): chipStyle, EnhancedChildProps, ModelsConfig, nativeOptionStyle, nativeSelectStyle, NativeSetting(), NativeSettings, PluginsConfig (+17 more)

### Community 40 - "package.json"
Cohesion: 0.07
Nodes (28): loadMathMarkdownPlugins(), bugs, url, description, engines, node, files, homepage (+20 more)

### Community 41 - "types.ts"
Cohesion: 0.11
Nodes (27): isObject(), normalizeToolCallBlock(), normalizeToolCalls(), AssistantMessage, BashExecutionMessage, BranchSummaryEntry, CompactionEntry, CustomEntry (+19 more)

### Community 42 - "settings-config.ts"
Cohesion: 0.11
Nodes (24): dynamic, GET(), PUT(), getSettingsPath(), disposeUtilityRpc(), APPROVAL_MODES, APPROVAL_POLICIES, assertOptionalBoolean() (+16 more)

### Community 43 - "Key Design Decisions & Traps"
Cohesion: 0.08
Nodes (25): Architecture, Auth and model config, Chat scroll-follow, Completion sound, Composer-attached panels (`components/ComposerPanels.tsx`), Design Tokens & UI Kit (`app/globals.css`, `components/ui/`), Event protocol differences vs pi, File access allow-list (+17 more)

### Community 44 - "session-file-references-core.ts"
Cohesion: 0.16
Nodes (20): GET(), MAX_INLINE_BASH_OUTPUT_BYTES, openRegularFileNoFollow(), readUtf8FileWithinLimit(), resolveBashOutputPath(), loadSubject(), collectStrings(), containsExactPathReference() (+12 more)

### Community 45 - "SessionSidebar-rows.tsx"
Cohesion: 0.13
Nodes (22): OmpWebLogo(), Props, OmpWebTitle(), PathLabel(), RunningSessionIndicator(), SidebarIconButton(), SidebarPortalMenu(), UnreadSessionIndicator() (+14 more)

### Community 46 - "TrayApplication"
Cohesion: 0.14
Nodes (13): ContextMenuStrip, OmpWebTray, DateTime, IDisposable, List, Mutex, Program, TrayApplication (+5 more)

### Community 47 - "rpc-process.ts"
Cohesion: 0.11
Nodes (17): decodeBase64(), encodeRpcFrames(), isSafeInteger(), lineByteLength(), MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES, PendingChunks, RpcFrameDecoder (+9 more)

### Community 48 - "file-access.ts"
Cohesion: 0.21
Nodes (20): GET(), GET(), dynamic, POST(), GET(), dynamic, POST(), checkCwdAllowed() (+12 more)

### Community 49 - "project-registry.ts"
Cohesion: 0.20
Nodes (22): DELETE(), GET(), parseLaunchConfig(), PATCH(), POST(), canonicalProjectPath(), EMPTY_REGISTRY, hideProject() (+14 more)

### Community 50 - "skills-service.ts"
Cohesion: 0.14
Nodes (20): dynamic, PATCH(), SkillInfo, buildScanRoots(), DISABLE_INVOCATION_KEYS, DISABLE_KEY_LINE_RE, discoverSkills(), getAncestorDirs() (+12 more)

### Community 51 - "PluginsConfig.tsx"
Cohesion: 0.17
Nodes (21): AddPluginPanel(), buttonStyle(), findInstalledPackage(), installLocation(), PackageDetail(), packageKey(), PluginAction, PluginsConfig() (+13 more)

### Community 52 - "skill-updates.ts"
Cohesion: 0.13
Nodes (19): buildSkillUpdateArgs(), checkGlobalSkill(), CheckOptions, checkProjectSkill(), checkSkillUpdate(), execFileAsync, Fetcher, fetchJson() (+11 more)

### Community 53 - "subagent-history.ts"
Cohesion: 0.14
Nodes (18): dynamic, GET(), parseJsonlLenient(), extractSubagentHistory(), MAX_SUBAGENT_COMPLETION_BYTES, MAX_SUBAGENT_TRANSCRIPT_BYTES, progressStatusToRoster(), progressUpsertBlocked() (+10 more)

### Community 54 - "invalidateSessionListCache"
Cohesion: 0.14
Nodes (17): DELETE(), invalidateAllSessionScanCaches(), invalidateSessionCaches(), invalidateSessionEntriesCache(), invalidateSessionListCache(), invalidateSessionListMeta(), listAllSessions(), resolveSessionIdByPath() (+9 more)

### Community 55 - "chat-transcript-plan.ts"
Cohesion: 0.16
Nodes (18): CommittedTranscript, renderClusteredProcessMessages(), withAssistantBlocks(), countToolCallBlocks(), countToolCalls(), findFinalAssistantIndex(), hasDisplayableProcessMessage(), hasFinalAssistantAnswer() (+10 more)

### Community 56 - "markdown.ts"
Cohesion: 0.12
Nodes (19): baseMarkdownPlugins, containsMathSyntax(), DisplayMathClose, findBracketDisplayClose(), findDisplayMathClose(), getDisplayMathGluedCloseContent(), indentDisplayMathContent(), isDisplayMathBlockBoundary() (+11 more)

### Community 57 - "app-update/route.ts"
Cohesion: 0.19
Nodes (17): CommitResult, dynamic, errorResponse(), GET(), POST(), dynamic, errorResponse(), OMP_KIND (+9 more)

### Community 58 - "models/route.ts"
Cohesion: 0.18
Nodes (18): compareModelEntries(), dynamic, EMPTY_MODELS, GET(), loadModels(), modelNameCollator, refreshModelsIfConfigChanged(), supportsFastMode() (+10 more)

### Community 59 - "ChatInput-draft-attachments.ts"
Cohesion: 0.13
Nodes (18): AttachedImage, AttachedTextFile, draftFilesToAttachedFiles(), draftImagesToAttachedImages(), draftImageToAttachedImage(), imageToDraftImage(), textFileToDraftFile(), AttachedTextFileData (+10 more)

### Community 60 - "bounded-form-data.ts"
Cohesion: 0.16
Nodes (12): cleanEnvVar(), dynamic, extractUpstreamErrorMessage(), POST(), declaredContentLength(), parseFormDataWithinLimit(), parseJsonWithinLimit(), RequestBodyTooLargeError (+4 more)

### Community 61 - "field.tsx"
Cohesion: 0.13
Nodes (19): AlertVariant, Check(), CheckProps, ConfirmDialog(), ConfirmDialogProps, Field(), FieldGroup(), FieldProps (+11 more)

### Community 62 - "rpc-utility.ts"
Cohesion: 0.15
Nodes (13): dynamic, GET(), dynamic, GET(), Params, dynamic, getState(), OmpLoginProvider (+5 more)

### Community 63 - "file-index/route.ts"
Cohesion: 0.14
Nodes (15): CacheEntry, execFileAsync, FileListing, GET(), getIndexCache(), IGNORED_NAMES, IGNORED_SUFFIXES, listWithGit() (+7 more)

### Community 64 - "provider-usage.ts"
Cohesion: 0.19
Nodes (18): dynamic, GET(), readIdentifier(), accountLabel(), CachedUsage, execFileAsync, fetchProviderUsage(), getProviderUsage() (+10 more)

### Community 65 - "search/route.ts"
Cohesion: 0.16
Nodes (17): dynamic, POST(), dynamic, formatInstalls(), parseInstallCount(), parseLimit(), parseSearchOutput(), POST() (+9 more)

### Community 66 - "omp-web-options.js"
Cohesion: 0.13
Nodes (16): isEnabled(), { parseArgs }, parseLaunchOptions(), printHelp(), TRUE_VALUES, fs, { parseArgs }, path (+8 more)

### Community 67 - "git-changes.ts"
Cohesion: 0.22
Nodes (17): createAddedFilePatch(), createTrackedFilePatch(), execFileAsync, findRepositoryRoot(), getGitFileDiff(), getGitStatus(), git(), hasNullByte() (+9 more)

### Community 68 - "pi-types.ts"
Cohesion: 0.10
Nodes (19): AvailableSlashCommandSource, BashResultInfo, ContextUsage, HostToolCallFrame, HostToolCancelFrame, HostToolDefinition, HostToolParameter, HostToolResultFrame (+11 more)

### Community 69 - "useAgentSession"
Cohesion: 0.15
Nodes (18): hasVisibleAssistantContent(), clearPersistedQueue(), EMPTY_QUEUE, isEmptyQueue(), persistQueue(), QUEUE_STORAGE_MAX_CHARS, QUEUE_STORAGE_PREFIX, readPersistedQueue() (+10 more)

### Community 70 - "RpcProcess"
Cohesion: 0.22
Nodes (5): RpcProtocolVersion, RpcProcess, runIsolatedUtilityCommand(), startProcess(), RpcSessionState

### Community 71 - "subagent-types.ts"
Cohesion: 0.17
Nodes (18): asAgentSource(), asProgressStatus(), batchSeqOf(), compareSubagents(), mergeSubagentRoster(), parseSubagentActivityEvent(), parseSubagentLifecycle(), parseSubagentProgress() (+10 more)

### Community 72 - "tool-preset-preference.ts"
Cohesion: 0.14
Nodes (12): getPreferredToolPreset(), setPreferredToolPreset(), STORAGE_KEY, StorageLike, jiti, getToolNamesForPreset(), isToolPreset(), PRESET_DEFAULT (+4 more)

### Community 73 - "web-slash-commands.ts"
Cohesion: 0.12
Nodes (7): expandWebSlashCommand(), getWebSlashCommand(), loadSubject(), WEB_SLASH_COMMAND_LOOKUP, WEB_SLASH_COMMANDS, WebSlashCommandDef, WebSlashCommandExpansion

### Community 74 - "dependencies"
Cohesion: 0.11
Nodes (19): dependencies, @base-ui/react, cmdk, katex, lucide-react, mammoth, mermaid, next (+11 more)

### Community 75 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 76 - "web-auth.ts"
Cohesion: 0.24
Nodes (12): POST(), BASE_PATH, createWebSession(), equal(), isValidWebPassword(), isValidWebSession(), isWebPasswordEnabled(), OMP_WEB_SESSION_COOKIE (+4 more)

### Community 77 - "ProviderUsageBar.tsx"
Cohesion: 0.22
Nodes (15): formatProviderUsageReport(), formatUsageReset(), ProviderUsageState, usageTone(), useProviderUsage(), COLLAPSED_STORAGE_KEY, DetailMeter(), ProviderUsageBar() (+7 more)

### Community 78 - "MessageView-diff-view.tsx"
Cohesion: 0.14
Nodes (12): PairedDiffResult(), PairedResult(), ResultDiff, SplitPatchView(), cleanPatchPath(), parseUnifiedPatch(), PendingChangeLine, SplitDiffCell (+4 more)

### Community 79 - "jiti"
Cohesion: 0.11
Nodes (9): jiti, jiti, jiti, jiti, jiti, jiti, jiti, jiti (+1 more)

### Community 80 - "omp-web UI/UX 全面重塑设计：温暖人文（Warm Paper）"
Cohesion: 0.11
Nodes (17): 1. 背景与目标, 2. 已确认的决策（拷问结论）, 3.1 色板, 3.2 字体与字阶, 3.3 形状、阴影、动效, 3. 设计令牌体系, 4. 组件栈, 5. 区域改造方案 (+9 more)

### Community 81 - "useUiScale.ts"
Cohesion: 0.17
Nodes (16): applyUiScale(), DEFAULT_UI_SCALE, getServerSnapshot(), listeners, nextUiScalePreference(), notifyListeners(), resolveUiScaleFactor(), resolveUiScalePercent() (+8 more)

### Community 82 - "skill-lock.ts"
Cohesion: 0.15
Nodes (13): SkillInstallInfo, AnnotateSkillOptions, annotateSkillsWithInstallInfo(), buildSkillsShUrl(), findLockEntry(), getInstallInfo(), GlobalLockPathOptions, isWithin() (+5 more)

### Community 83 - "image-attachments.ts"
Cohesion: 0.18
Nodes (15): Base64ImageAttachment, getAgentRequestByteLength(), getBase64DecodedByteLength(), getImageByteLengthWithinLimits(), isBase64DataChar(), jsonStringByteLength(), MAX_ATTACHED_IMAGE_BYTES, MAX_ATTACHED_IMAGES (+7 more)

### Community 84 - "network-addresses.js"
Cohesion: 0.22
Nodes (15): formatAddressBanner(), getAccessibleAddresses(), getBrowserUrl(), isIgnoredAddress(), isLoopbackHost(), isStandardPhysicalInterface(), isTailscaleAddress(), isVirtualBridge() (+7 more)

### Community 85 - "useFontSize.ts"
Cohesion: 0.18
Nodes (15): applyFontSize(), DEFAULT_FONT_SIZE, FONT_SIZE_CHANGE_EVENT, FontSizePreference, getServerSnapshot(), listeners, nextFontSizePreference(), notifyListeners() (+7 more)

### Community 86 - "npm-update.ts"
Cohesion: 0.20
Nodes (13): dynamic, GET(), NO_STORE_HEADERS, noContent(), getGitHubReleaseNotes(), GitHubReleaseNotes, isSafeReleaseUrl(), MAX_BODY_BYTES (+5 more)

### Community 87 - "omp-web-launchd.js"
Cohesion: 0.19
Nodes (14): fail(), fs, HOME, install(), isExecutableFile(), launchctl(), LOG_DIR, os (+6 more)

### Community 88 - "AgentMessage"
Cohesion: 0.16
Nodes (14): ChatMinimap, extractPreviewText(), getBarWidth(), NavNode, Props, jiti, CommittedTranscriptProps, Props (+6 more)

### Community 89 - "ansi.ts"
Cohesion: 0.24
Nodes (14): ansi256Color(), ANSI_8_COLORS, ANSI_BRIGHT_COLORS, AnsiSegment, applyAnsiCodes(), firstVisibleChar(), lastNonSpaceVisibleCharIndex(), normalizeCustomPanelLines() (+6 more)

### Community 90 - "withStorageNamespace"
Cohesion: 0.19
Nodes (12): geist, jetbrainsMono, metadata, notoSansMono, notoSerifSC, RootLayout(), sourceSerif, viewport (+4 more)

### Community 91 - "generate-release-notes.js"
Cohesion: 0.24
Nodes (13): cleanSubject(), { execFileSync }, extractContributors(), extractFromChangelog(), extractUsername(), formatReleaseNotes(), generateReleaseNotes(), IGNORED_CONTRIBUTORS (+5 more)

### Community 92 - "draft-store.ts"
Cohesion: 0.21
Nodes (11): MinimizedComposerBar, ChatDraft, ChatDraftFile, ChatDraftImage, clearDraft(), cloneDraft(), getDraft(), getDraftSummary() (+3 more)

### Community 93 - "transcript.ts"
Cohesion: 0.23
Nodes (12): assistantText(), assistantThinking(), fenced(), pickFence(), jiti, textOf(), toolInputSummary(), TRANSCRIPT_BLOCK_CHAR_LIMIT (+4 more)

### Community 94 - "scripts"
Cohesion: 0.13
Nodes (15): scripts, build, dev, dev:lan, lint, prepack, release:check, start (+7 more)

### Community 95 - "directory-browser.ts"
Cohesion: 0.31
Nodes (11): GET(), BrowsableDirectory, getBrowseStartDirectory(), getParentDirectory(), getWindowsDriveCandidates(), listDirectories(), listWindowsDrives(), normalizeDirectory() (+3 more)

### Community 96 - "AppShell-layout.tsx"
Cohesion: 0.16
Nodes (13): clampRightPanelWidth(), clampSidebarWidth(), loadRightPanelWidth(), loadSidebarWidth(), PanelLoadingFallback(), projectLabel(), RIGHT_PANEL_MAX_WIDTH, RIGHT_PANEL_MIN_WIDTH (+5 more)

### Community 97 - "ompweb — Product & Architecture Contract"
Cohesion: 0.14
Nodes (13): Data and mutation boundaries, Direct file access, Distribution and identity, Non-goals, OMP-owned state, ompweb — Product & Architecture Contract, Product principles, Purpose (+5 more)

### Community 98 - "file-fuzzy.ts"
Cohesion: 0.20
Nodes (12): AT_RESULT_LIMIT, AtInsertion, AtQueryMatch, buildAtInsertText(), buildEntriesFromFiles(), extractAtQuery(), filterFileEntries(), isSubsequence() (+4 more)

### Community 99 - "workspace-memory.ts"
Cohesion: 0.22
Nodes (7): clearLastOpenSession(), getLastOpenSession(), readEntries(), setLastOpenSession(), STORAGE_KEY, StorageLike, jiti

### Community 100 - "devDependencies"
Cohesion: 0.14
Nodes (14): devDependencies, eslint, eslint-config-next, jiti, postcss, react-test-renderer, tailwindcss, @tailwindcss/postcss (+6 more)

### Community 101 - "model-roles.ts"
Cohesion: 0.28
Nodes (10): dynamic, GET(), PUT(), POST(), configPath(), enableProvider(), ModelRoles, readDisabledProviders() (+2 more)

### Community 102 - "translate"
Cohesion: 0.23
Nodes (10): ErrorBoundary(), GIT_STATUS_LABEL_KEYS, fetchPatch(), fetchStatus(), GitChangesPanel(), Props, GitFileDiffResponse, GitFileStatusKind (+2 more)

### Community 103 - "BranchNavigator.tsx"
Cohesion: 0.27
Nodes (11): BranchNavigator(), buildActivePath(), compress(), getLabel(), hasBranch(), isMessageEntry(), messagePreview(), Props (+3 more)

### Community 105 - "useAgentSession-notices.ts"
Cohesion: 0.19
Nodes (12): createNoticeId(), fillPendingNotices(), markOldestNoticeExiting(), MAX_NOTICES, NOTICE_ERROR_VISIBLE_MS, NOTICE_EXIT_ANIMATION_MS, NOTICE_VISIBLE_MS, NoticeAction (+4 more)

### Community 106 - "file-links.ts"
Cohesion: 0.26
Nodes (10): API_PATH_PREFIX, fileUrlToPath(), isPathInside(), looksLikeRelativeFileHref(), NEXT_PATH_PREFIX, normalizeLocalPath(), resolveLocalFileHref(), safeDecode() (+2 more)

### Community 107 - "process-lifecycle.js"
Cohesion: 0.27
Nodes (9): childHasExited(), forwardedSignals, getSignalExitCode(), killChildTree(), os, { spawn }, terminateChildProcess(), waitForChildExit() (+1 more)

### Community 108 - "SyntaxHighlightedCode.tsx"
Cohesion: 0.26
Nodes (8): Props, SyntaxHighlightedCode(), ensureLanguageRegistered(), GRAMMARS, isLanguageRegistered(), IMPORTANT: every grammar is registered EAGERLY via static imports. The old, vs, vscDarkPlus

### Community 109 - "http-dispatcher.ts"
Cohesion: 0.30
Nodes (10): register(), configureHttpDispatcher(), createUndiciClient(), createUndiciOriginDispatcher(), DEFAULT_HTTP_IDLE_TIMEOUT_MS, DispatcherGlobal, ignoreUndiciDispatcherError(), parseHttpIdleTimeoutMs() (+2 more)

### Community 110 - "macos-launchd.mts"
Cohesion: 0.29
Nodes (10): fail(), HOME, install(), isExecutableFile(), launchctl(), LOG_DIR, PLIST, uninstall() (+2 more)

### Community 111 - "terminal-input.ts"
Cohesion: 0.24
Nodes (8): ExtensionCustomPanel(), ALT_ARROW_SEQUENCES, asBracketedPaste(), legacyCtrlSequence(), SPECIAL_KEY_SEQUENCES, TerminalKeyEventLike, loadSubject(), toTerminalKeyData()

### Community 112 - "ExtensionDialog.tsx"
Cohesion: 0.24
Nodes (9): ExtensionDialog(), ExtensionDialogRequest, ExtensionDialogResponse, dialogStack, FOCUSABLE_SELECTOR, focusableIn(), ModalDialogOptions, useModalDialog() (+1 more)

### Community 113 - "message-update-coalescer.ts"
Cohesion: 0.20
Nodes (5): CoalescableEvent, createMessageUpdateCoalescer(), FlushScheduler, MessageUpdateCoalescer, loadSubject()

### Community 114 - "startRpcSession"
Cohesion: 0.24
Nodes (6): newSessionErrorResponse(), POST(), MAX_AGENT_COMMAND_REQUEST_BYTES, getLocks(), launchConfigForCwd(), startRpcSession()

### Community 115 - "Props"
Cohesion: 0.29
Nodes (8): Props, QueuedMessages, SessionStatsInfo, ActiveGoal, ActivePlan, createActiveGoal(), formatGoalElapsed(), parseActiveGoal()

### Community 116 - "RightPanel.tsx"
Cohesion: 0.31
Nodes (8): ExplorerRow, FileExplorerHandle, getFileIcon(), Props, RightPanel, Props, Tab, TabBar()

### Community 117 - "omp-web-tray.ps1"
Cohesion: 0.40
Nodes (7): Check-AutostartShortcut(), Restart-WebServer(), Set-AutostartShortcut(), Start-WebServer(), Stop-WebServer(), Update-TrayUI(), Write-ServiceLog()

### Community 118 - "attachOutput"
Cohesion: 0.31
Nodes (9): attachOutput(), main(), readPackageVersion(), serverEnvironment(), spawnRestartGate(), spawnServer(), trackServer(), waitForRestartRequest() (+1 more)

### Community 119 - "TodoList.tsx"
Cohesion: 0.28
Nodes (5): previewTaskOrder(), expandedPanel(), jiti, longPlan, TodoList()

### Community 120 - "updates.ts"
Cohesion: 0.28
Nodes (8): checkOmpUpdate(), createCachedOmpUpdateCheck(), defaultCachedOmpUpdateCheck, OMP_UPDATE_CHECK_TIMEOUT_MS, OMP_UPDATE_CHECK_TTL_MS, OmpUpdateStatus, parseOmpUpdateStatus(), runOmpUpdate()

### Community 121 - "login/[provider]/route.ts"
Cohesion: 0.32
Nodes (7): dynamic, GET(), getLoginRegistry(), LOGIN_EXTRA_ARGS, PendingLogin, POST(), RpcFrame

### Community 122 - "node-version.test.mjs"
Cohesion: 0.36
Nodes (6): getUnsupportedNodeVersionMessage(), isNodeVersionSupported(), parseNodeVersion(), {
  MIN_NODE_VERSION,
  getUnsupportedNodeVersionMessage,
  isNodeVersionSupported,
}, packageJson, require

### Community 123 - "ChatInput-model-picker.tsx"
Cohesion: 0.39
Nodes (7): ModelOption, groupModelOptionsByProvider(), ModelPickerPanel(), ModelPickerPanelProps, orderProviderGroups(), ProviderBadge(), ProviderModelGroup

### Community 124 - "Worktrees in ompweb"
Cohesion: 0.25
Nodes (7): Creating a Worktree, Removing a Worktree, Sessions and Worktrees, Switching Worktrees, Troubleshooting, When the Worktree Control Appears, Worktrees in ompweb

### Community 125 - "ompweb 里的 Worktree"
Cohesion: 0.25
Nodes (7): ompweb 里的 Worktree, 什么时候会看到 Worktree 控件, 会话和 Worktree 的关系, 切换 Worktree 会影响什么, 删除 Worktree, 常见问题, 新建 Worktree

### Community 126 - "model-scope.ts"
Cohesion: 0.32
Nodes (6): assertNoAmbiguousModelScopes(), exactMatches(), hasGlob(), ModelScopeCandidate, models, THINKING_LEVEL_SUFFIXES

### Community 127 - "security-headers.test.mjs"
Cohesion: 0.29
Nodes (4): FILE_RESPONSE_PATHS, { getPathMatch }, jiti, require

### Community 128 - "Contributing to omp-web"
Cohesion: 0.29
Nodes (6): Checks (must pass before submitting), Contributing to omp-web, Conventions, Pull requests, Reporting issues, Setup

### Community 130 - "reconcile-guard.ts"
Cohesion: 0.29
Nodes (3): createReconcileGuard(), ReconcileGuard, ReconcileGuardOptions

### Community 131 - "port-availability.js"
Cohesion: 0.40
Nodes (4): isPortAvailable(), net, { isPortAvailable }, require

### Community 132 - "Release Checklist"
Cohesion: 0.33
Nodes (5): Bootstrap the first release, One-time trusted-publisher setup, Release Checklist, Release later versions, Verify

### Community 133 - "rpc-process-runtime.test.mjs"
Cohesion: 0.33
Nodes (3): { encodeRpcFrames }, jiti, { RpcProcess, RpcCommandTimeoutError }

### Community 134 - "omp-web-service.ps1"
Cohesion: 0.47
Nodes (3): Start-WebServer(), Stop-WebServer(), Write-ServiceLog()

### Community 135 - "initial-navigation.ts"
Cohesion: 0.50
Nodes (3): getInitialNavigation(), InitialNavigation, loadSubject()

### Community 136 - "session-change-bus.ts"
Cohesion: 0.50
Nodes (3): Listener, listeners, loadSubject()

### Community 137 - "subagent-types.test.mjs"
Cohesion: 0.50
Nodes (3): batch(), fromFile(), jiti

### Community 138 - "thinking-levels.test.mjs"
Cohesion: 0.40
Nodes (4): jiti, LIVE_LUNA, LIVE_NON_REASONING, LUNA

### Community 139 - "next.config.ts"
Cohesion: 0.40
Nodes (3): NOTE: scoped to /_next/static/ only — broader /_next/ patterns would, { version }, next

### Community 141 - "browser-notifications.ts"
Cohesion: 0.50
Nodes (3): CompletionNotificationEnvironment, showCompletionNotification(), WindowNotificationLike

### Community 143 - "usage-db.test.mjs"
Cohesion: 0.67
Nodes (3): jiti, loadSubject(), withTempDbDir()

### Community 144 - "bin"
Cohesion: 0.50
Nodes (4): bin, ompweb, ompweb-launchd, ompweb-tray

### Community 156 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

## Knowledge Gaps
- **799 isolated node(s):** `dynamic`, `dynamic`, `dynamic`, `Scope`, `dynamic` (+794 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1044 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `react` to `MessageView.tsx`, `useAgentSession.ts`, `AppUpdateDialog.tsx`, `useI18n`, `ModelsConfig.tsx`, `lucide-react`, `useAgentSession.rpc.test.mjs`, `AppShell.tsx`, `ChatInput.tsx`, `FileExplorer.test.mjs`, `ChatWindow.tsx`, `useTheme.ts`, `FileViewer.tsx`, `withBasePath`, `SessionSidebar.tsx`, `FileExplorer.tsx`, `ComposerPanels.tsx`, `SettingsConfig.tsx`, `package.json`, `SessionSidebar-rows.tsx`, `PluginsConfig.tsx`, `markdown.ts`, `field.tsx`, `ProviderUsageBar.tsx`, `MessageView-diff-view.tsx`, `useUiScale.ts`, `useFontSize.ts`, `AgentMessage`, `ansi.ts`, `withStorageNamespace`, `translate`, `BranchNavigator.tsx`, `ChatInput.test.mjs`, `SyntaxHighlightedCode.tsx`, `ExtensionDialog.tsx`, `RightPanel.tsx`, `TodoList.tsx`, `ChatInput-model-picker.tsx`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **Why does `jiti` connect `jiti` to `agents-service.ts`, `chat-transcript-plan.test.mjs`, `usage-db.ts`, `rpc-process-runtime.test.mjs`, `AppUpdateDialog.tsx`, `subagent-types.test.mjs`, `thinking-levels.test.mjs`, `useAgentSession.rpc.test.mjs`, `model-catalog.ts`, `project-registry.test.mjs`, `usage-db.test.mjs`, `worktree.ts`, `react`, `FileExplorer.test.mjs`, `file-access.test.mjs`, `file-paths.test.mjs`, `npm-update.test.mjs`, `mcp-config.test.mjs`, `useTheme.ts`, `updates.test.mjs`, `reconcile-guard.test.mjs`, `sse-lifecycle.test.mjs`, `archive.ts`, `withBasePath`, `SessionSidebar.tsx`, `usage-rates.test.mjs`, `models-config.ts`, `ComposerPanels.tsx`, `package.json`, `settings-config.ts`, `rpc-process.ts`, `skills-service.ts`, `skill-updates.ts`, `subagent-history.ts`, `invalidateSessionListCache`, `bounded-form-data.ts`, `file-index/route.ts`, `tool-preset-preference.ts`, `web-auth.ts`, `useUiScale.ts`, `skill-lock.ts`, `useFontSize.ts`, `AgentMessage`, `transcript.ts`, `workspace-memory.ts`, `ChatInput.test.mjs`, `file-links.ts`, `TodoList.tsx`, `security-headers.test.mjs`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Why does `isRecord()` connect `session-reader.ts` to `agents-service.ts`, `provider-usage.ts`, `MessageView.tsx`, `useAgentSession.ts`, `session-files.ts`, `useAgentSession`, `models-config.ts`, `ComposerPanels.tsx`, `model-roles.ts`, `subagent-types.ts`, `settings-config.ts`, `usage-db.ts`, `model-catalog.ts`, `mcp/route.ts`, `rpc-process.ts`, `sessions/[id]/route.ts`, `subagent-history.ts`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `useI18n()` (e.g. with `getLocale()` and `getServerSnapshot()`) actually correct?**
  _`useI18n()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `dynamic`, `dynamic`, `dynamic` to the rest of the system?**
  _799 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `agents-service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07272727272727272 - nodes in this community are weakly interconnected._
- **Should `usage-db.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06502816180235535 - nodes in this community are weakly interconnected._