# SoundCheck processing worker (GPU). Works on any CUDA host: RunPod, AWS g6/g5, GCP L4, Modal (see modal_app.py).
#   docker build -t soundcheck-worker services/pipeline
#   docker run --gpus all -e SUPABASE_URL=... -e SUPABASE_SECRET_KEY=... soundcheck-worker
FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN pip install --no-cache-dir uv && uv pip install --system --no-cache .
# Pre-fetch model weights into the image so cold starts don't download ~1.5 GB.
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')" \
 && python -c "from torchaudio.pipelines import MMS_FA; MMS_FA.get_model(with_star=False)" \
 && python -c "import torchcrepe, torch; torchcrepe.predict(torch.zeros(1,16000), 16000, 160, 50, 1000, model='full', device='cpu')"
ENV PYTHONUNBUFFERED=1
CMD ["karaoke-pipeline", "worker"]
