from fastapi import FastAPI
from pydantic import BaseModel
import numpy as np

app = FastAPI(title="QSTEEL AI Service")

class ForecastRequest(BaseModel):
    series: list[float] | None = None
    horizon: int = 7

class ForecastResponse(BaseModel):
    forecast: list[float]

@app.post("/forecast", response_model=ForecastResponse)
async def forecast(req: ForecastRequest):
    series = np.array(req.series or [10,12,11,13,12,14,15], dtype=float)
    horizon = req.horizon
    mu = float(series[-3:].mean()) if len(series) >= 3 else float(series.mean())
    # naive + small noise for demo
    preds = (mu * np.ones(horizon) + np.random.normal(scale=0.3, size=horizon)).tolist()
    return {"forecast": preds}
