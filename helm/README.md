# Orpheus Kubernetes Deployment

Deploy Orpheus on a self-hosted **k3s** cluster using Helm.

---

## What You'll Need

| Tool | Purpose | Install |
|------|---------|---------|
| **k3s** | Lightweight Kubernetes (includes Traefik ingress + local-path storage) | `curl -sfL https://get.k3s.io \| sh -` |
| **Helm 3** | Kubernetes package manager | `curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 \| bash` |
| **Docker** | Build container images (on any machine) | https://docs.docker.com/get-docker/ |

**Hardware:** 2+ CPU cores, 4 GB RAM minimum. 8+ GB if running Ollama AI.

---

## Step 1 — Install k3s

```bash
curl -sfL https://get.k3s.io | sh -
```

Wait for it to finish, then verify:

```bash
sudo k3s kubectl get nodes
# Should show your node as "Ready"
```

Set up kubeconfig so `kubectl` and `helm` work without `sudo`:

```bash
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
export KUBECONFIG=~/.kube/config
```

Add the `export` line to your `~/.bashrc` or `~/.zshrc` to persist it.

k3s ships with **Traefik** (ingress controller) and **local-path-provisioner** (storage) out of the box — no extra setup needed.

---

## Step 2 — Install Helm

```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
helm version
```

---

## Step 3 — Build and Import Container Images

Build the server and client Docker images, then import them into k3s:

```bash
cd /path/to/orpheus

# Build images
docker build -t orpheus-server:latest ./server
docker build -t orpheus-client:latest ./client

# Import into k3s (run on the k3s node)
docker save orpheus-server:latest | sudo k3s ctr images import -
docker save orpheus-client:latest | sudo k3s ctr images import -
```

Verify they're available:

```bash
sudo k3s ctr images list | grep orpheus
```

> **Building on a different machine?** Save the tarballs and copy them over:
> ```bash
> docker save orpheus-server:latest -o orpheus-server.tar
> docker save orpheus-client:latest -o orpheus-client.tar
> scp orpheus-*.tar user@k3s-node:~/
> # On the k3s node:
> sudo k3s ctr images import orpheus-server.tar
> sudo k3s ctr images import orpheus-client.tar
> ```

---

## Step 4 — Configure Your Values

Create a `values-local.yaml` file with your settings:

```yaml
global:
  domain: "orpheus.local"         # Or your server's hostname/IP

spotify:
  clientId: "your-spotify-client-id"
  clientSecret: "your-spotify-client-secret"
  # Leave empty to auto-generate from domain, or set explicitly:
  # redirectUri: "http://orpheus.local/api/auth/callback"

# Enable AI (optional)
ollama:
  enabled: true
```

---

## Step 5 — Deploy

```bash
helm install orpheus ./helm/orpheus -f values-local.yaml
```

Watch pods come up:

```bash
kubectl get pods -w
```

All pods should reach `Running` status within a minute or two.

---

## Step 6 — DNS Setup

Add your domain to `/etc/hosts` (on the machine you'll browse from):

```bash
# Replace with your k3s node's actual IP
echo "192.168.1.100  orpheus.local" | sudo tee -a /etc/hosts
```

---

## Step 7 — Spotify OAuth

1. Go to https://developer.spotify.com/dashboard
2. Open your app's settings
3. Add this as a **Redirect URI**:
   ```
   http://orpheus.local/api/auth/callback
   ```
   (Must match exactly — use `https://` if you enabled TLS in values)
4. Open http://orpheus.local in your browser
5. Navigate to Settings and click Authenticate

---

## Step 8 — Pull the AI Model (if Ollama enabled)

```bash
kubectl exec -it orpheus-ollama-0 -- ollama pull llama3.2
```

This downloads the model (~2 GB) into the persistent volume. It only needs to be done once.

Verify:

```bash
kubectl exec -it orpheus-ollama-0 -- ollama list
```

---

## GPU Setup for Ollama (Optional)

If your k3s node has an NVIDIA GPU, you can enable GPU acceleration for Ollama.

### 1. Install NVIDIA drivers

```bash
# Ubuntu/Debian
sudo apt install nvidia-driver-550
sudo reboot
nvidia-smi    # Verify
```

### 2. Install NVIDIA Container Toolkit

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=containerd
sudo systemctl restart k3s
```

### 3. Deploy NVIDIA Device Plugin

```bash
kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.17.0/deployments/static/nvidia-device-plugin.yml
```

Verify GPU is detected:

```bash
kubectl get nodes -o json | jq '.items[].status.allocatable["nvidia.com/gpu"]'
```

### 4. Enable GPU in Values

Update your `values-local.yaml`:

```yaml
ollama:
  enabled: true
  gpu:
    enabled: true
    count: 1
```

Upgrade the release:

```bash
helm upgrade orpheus ./helm/orpheus -f values-local.yaml
```

---

## Upgrading

When you make code changes:

```bash
# Rebuild images
docker build -t orpheus-server:latest ./server
docker build -t orpheus-client:latest ./client

# Re-import into k3s
docker save orpheus-server:latest | sudo k3s ctr images import -
docker save orpheus-client:latest | sudo k3s ctr images import -

# Upgrade the Helm release
helm upgrade orpheus ./helm/orpheus -f values-local.yaml

# Force pod restart (if using the same "latest" tag)
kubectl rollout restart deployment/orpheus-server
kubectl rollout restart deployment/orpheus-client
```

---

## Useful Commands

```bash
# Pod status
kubectl get pods -l app.kubernetes.io/instance=orpheus

# Server logs
kubectl logs -l app.kubernetes.io/component=server -f

# Client (nginx) logs
kubectl logs -l app.kubernetes.io/component=client -f

# Ollama logs
kubectl logs -l app.kubernetes.io/component=ollama -f

# Check ingress
kubectl get ingress

# Describe a failing pod
kubectl describe pod <pod-name>

# Shell into the server pod
kubectl exec -it deploy/orpheus-server -- sh

# Check health endpoint
kubectl exec -it deploy/orpheus-client -- wget -qO- http://orpheus-server:3000/api/health

# Uninstall
helm uninstall orpheus
```

---

## Troubleshooting

### Pods stuck in ImagePullBackOff

Images haven't been imported into k3s. Re-run the `docker save | k3s ctr images import` commands. Make sure `imagePullPolicy` is `IfNotPresent` (the default).

### Client returns 502 Bad Gateway

The server pod isn't ready yet, or has crashed. Check:

```bash
kubectl get pods -l app.kubernetes.io/component=server
kubectl logs -l app.kubernetes.io/component=server
```

### WebSocket not connecting

Verify the nginx ConfigMap has the correct upstream:

```bash
kubectl get configmap orpheus-client-nginx -o yaml | grep proxy_pass
```

It should show `http://orpheus-server:3000`.

### Spotify auth callback fails

The redirect URI must match **exactly** between:
1. Your `values-local.yaml` (or auto-generated from `global.domain`)
2. The Spotify Developer Dashboard

Check what's currently set:

```bash
kubectl get secret orpheus-spotify -o jsonpath='{.data.SPOTIFY_REDIRECT_URI}' | base64 -d
```

### SQLite database locked

Only one server replica should be running:

```bash
kubectl get pods -l app.kubernetes.io/component=server
# Should show exactly 1 pod
```

### Ollama not reachable

```bash
# Check Ollama pod is running
kubectl get pods -l app.kubernetes.io/component=ollama

# Test connectivity from server
kubectl exec -it deploy/orpheus-server -- wget -qO- http://orpheus-ollama:11434/api/tags
```
