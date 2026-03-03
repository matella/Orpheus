{{/*
Common labels applied to all resources.
*/}}
{{- define "orpheus.labels" -}}
app.kubernetes.io/name: orpheus
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{/*
Server fullname — used for Deployment, Service, and PVC names.
*/}}
{{- define "orpheus.server.fullname" -}}
{{ .Release.Name }}-server
{{- end }}

{{/*
Client fullname — used for Deployment, Service, and ConfigMap names.
*/}}
{{- define "orpheus.client.fullname" -}}
{{ .Release.Name }}-client
{{- end }}

{{/*
Ollama fullname — used for StatefulSet and Service names.
*/}}
{{- define "orpheus.ollama.fullname" -}}
{{ .Release.Name }}-ollama
{{- end }}

{{/*
Spotify redirect URI — auto-generate from global.domain if not explicitly set.
*/}}
{{- define "orpheus.spotify.redirectUri" -}}
{{- if .Values.spotify.redirectUri -}}
{{ .Values.spotify.redirectUri }}
{{- else -}}
{{- if .Values.ingress.tls.enabled -}}
https://{{ .Values.global.domain }}/api/auth/callback
{{- else -}}
http://{{ .Values.global.domain }}/api/auth/callback
{{- end -}}
{{- end -}}
{{- end }}

{{/*
Ollama internal service URL.
*/}}
{{- define "orpheus.ollama.url" -}}
http://{{ include "orpheus.ollama.fullname" . }}:{{ .Values.ollama.port }}
{{- end }}
