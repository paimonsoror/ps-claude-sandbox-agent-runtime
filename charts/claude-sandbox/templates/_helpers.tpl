{{/*
Chart-wide names and labels.
*/}}
{{- define "claude-sandbox.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "claude-sandbox.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "claude-sandbox.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "claude-sandbox.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "claude-sandbox.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "claude-sandbox.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Merge one definition over its kind's defaults. Takes dict{root, name, sb}; returns JSON.
Lists in the definition replace the defaults' lists, except extraAllowedDomains, which the
domains helper appends.
*/}}
{{- define "claude-sandbox.mergeDefinition" -}}
{{- $kind := .sb.kind | default "workspace" -}}
{{- $defaults := index (.root.Values.sandboxDefaults | default dict) $kind | default dict -}}
{{- $merged := mustMergeOverwrite (dict) (deepCopy $defaults) (deepCopy .sb) -}}
{{- $_ := set $merged "name" .name -}}
{{- $_ := set $merged "kind" $kind -}}
{{- if not (hasKey $merged "enabled") -}}{{- $_ := set $merged "enabled" true -}}{{- end -}}
{{- toJson $merged -}}
{{- end -}}

{{/*
Every sandbox definition, from .Values.sandboxes and from files matching sandboxFiles.glob
inside the chart, each merged with its kind's defaults. Returns a JSON map name -> definition.
A definition from .Values wins over a file of the same name.
*/}}
{{- define "claude-sandbox.sandboxes" -}}
{{- $root := . -}}
{{- $out := dict -}}
{{- if and .Values.sandboxFiles .Values.sandboxFiles.enabled -}}
{{- range $path, $bytes := .Files.Glob .Values.sandboxFiles.glob -}}
{{- $doc := $bytes | toString | fromYaml -}}
{{- if hasKey $doc "Error" -}}
{{- fail (printf "sandbox file %s: %s" $path (index $doc "Error")) -}}
{{- end -}}
{{- $entries := dict -}}
{{- if hasKey $doc "kind" -}}
{{- $n := $doc.name | default (base $path | trimSuffix ".yaml" | trimSuffix ".yml") -}}
{{- $_ := set $entries $n (omit $doc "name") -}}
{{- else -}}
{{- $entries = $doc -}}
{{- end -}}
{{- range $name, $sb := $entries -}}
{{- $_ := set $out $name (include "claude-sandbox.mergeDefinition" (dict "root" $root "name" $name "sb" $sb) | fromJson) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- range $name, $sb := (.Values.sandboxes | default dict) -}}
{{- $_ := set $out $name (include "claude-sandbox.mergeDefinition" (dict "root" $root "name" $name "sb" $sb) | fromJson) -}}
{{- end -}}
{{- toJson $out -}}
{{- end -}}

{{/*
Per-sandbox helpers. Each takes a dict with keys `root` (the top-level context) and `sb`
(one merged definition, which carries .name and .kind).
*/}}
{{- define "claude-sandbox.sb.fullname" -}}
{{- printf "%s-%s" (include "claude-sandbox.fullname" .root) .sb.name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "claude-sandbox.sb.selectorLabels" -}}
app.kubernetes.io/name: {{ include "claude-sandbox.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
claude-sandbox/name: {{ .sb.name }}
claude-sandbox/kind: {{ .sb.kind }}
{{- end -}}

{{/* The union of the base, the kind's and the sandbox's allowlists, in srt grammar. */}}
{{- define "claude-sandbox.sb.domains" -}}
{{- $all := concat (.root.Values.network.baseAllowedDomains | default list) (.sb.allowedDomains | default list) (.sb.extraAllowedDomains | default list) | uniq -}}
{{- toJson $all -}}
{{- end -}}

{{/*
srt settings for one sandbox (same schema as ~/.srt-settings.json). Rendered as JSON.
*/}}
{{- define "claude-sandbox.sb.srtSettings" -}}
{{- $root := .root -}}
{{- $sb := .sb -}}
{{- $domains := include "claude-sandbox.sb.domains" . | fromJsonArray -}}
{{- $allowWrite := list "/workspace" "/home/agent" "/tmp" -}}
{{- if eq $sb.kind "managed-agents-worker" -}}
{{- $allowWrite = append $allowWrite "/mnt/memory" -}}
{{- end -}}
{{- $settings := dict
      "network" (dict
        "allowedDomains" $domains
        "deniedDomains" (list)
        "strictAllowlist" true
        "deniedResolvedAddresses" ($root.Values.network.deniedResolvedAddresses | default list))
      "filesystem" (dict
        "allowWrite" $allowWrite
        "denyWrite" (list)
        "denyRead" (list "/etc/srt" "/etc/claude-code"))
      "allowNestedUserNamespaces" false
-}}
{{- if eq $root.Values.isolation.mode "weak" -}}
{{- $_ := set $settings "enableWeakerNestedSandbox" true -}}
{{- end -}}
{{- $settings = mustMergeOverwrite $settings (deepCopy ($root.Values.srt.extraSettings | default dict)) -}}
{{- toPrettyJson $settings -}}
{{- end -}}

{{/*
Claude Code managed settings for a workspace sandbox (/etc/claude-code/managed-settings.json).
*/}}
{{- define "claude-sandbox.sb.managedSettings" -}}
{{- $root := .root -}}
{{- $sb := .sb -}}
{{- $domains := include "claude-sandbox.sb.domains" . | fromJsonArray -}}
{{- $sandbox := dict "enabled" false -}}
{{- if eq $root.Values.isolation.wrap "claude-bash-sandbox" -}}
{{- $sandbox = dict
      "enabled" true
      "failIfUnavailable" true
      "allowUnsandboxedCommands" false
      "autoAllowBashIfSandboxed" true
      "network" (dict "allowedDomains" $domains "strictAllowlist" true) -}}
{{- if eq $root.Values.isolation.mode "weak" -}}
{{- $_ := set $sandbox "enableWeakerNestedSandbox" true -}}
{{- end -}}
{{- end -}}
{{- $settings := dict
      "sandbox" $sandbox
      "permissions" (dict "disableBypassPermissionsMode" "disable")
      "forceLoginMethod" "claudeai"
      "env" (dict "DISABLE_UPDATES" "1" "DISABLE_TELEMETRY" "1")
-}}
{{- $settings = mustMergeOverwrite $settings (deepCopy ($root.Values.claude.managedSettings | default dict)) -}}
{{- toPrettyJson $settings -}}
{{- end -}}
