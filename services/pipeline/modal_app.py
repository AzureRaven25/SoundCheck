"""Run the SoundCheck worker on Modal (serverless GPUs, billed per second, scales to zero).

One-time setup (needs your Modal account):
    pip install modal && modal setup
    modal secret create soundcheck-supabase SUPABASE_URL=https://ppmzqjrfcbemzzbwicrd.supabase.co SUPABASE_SECRET_KEY=...
Deploy:
    modal deploy services/pipeline/modal_app.py
A cron drains the queue every minute; each run processes jobs until the queue is empty, then exits,
so you pay only while songs are being processed (~1–2 GPU-minutes per song on an L4).
"""

import modal

image = modal.Image.from_dockerfile("services/pipeline/Dockerfile", context_dir="services/pipeline")
app = modal.App("soundcheck-worker", image=image)


@app.function(gpu="L4", timeout=60 * 30, secrets=[modal.Secret.from_name("soundcheck-supabase")],
              schedule=modal.Cron("* * * * *"), max_containers=4)
def drain_queue():
    from karaoke_pipeline.worker import run

    while run(once=True):  # returns the number of jobs processed (0 when the queue is empty)
        pass
