"""Gerçekçiye yakın sentetik toraks: damarlar, kemik, mediastinum, dokunsal gürültü, yumuşak nodül."""
import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import model_lib

model_lib.SCORE_THRESH = 0.05
print("device:", model_lib.DEVICE, flush=True)
W,H,D = 448,448,200   # ~45cm x 45cm x 250mm @ 1mm
sz,sy,sx = 1.0,1.0,1.25
rng = np.random.default_rng(42)
hu = np.full((D,H,W), -1000.0, dtype=np.float32)

zz,yy,xx = np.meshgrid(np.linspace(-1,1,D), np.linspace(-1,1,H), np.linspace(-1,1,W), indexing="ij")
r2 = yy**2 + xx**2
body = r2 < 0.90**2
# yumuşak doku (göğüs duvarı + mediastinum) ~40HU + gürültü
hu[body] = rng.normal(40, 30, size=int(body.sum())).astype(np.float32)

# Akciğerler (posterior ağırlıklı, ~-850HU orta, hafif gradyan)
lung_l = (((yy+0.22)**2/0.30 + (xx+0.40)**2/0.19) < 1.0)
lung_r = (((yy+0.22)**2/0.30 + (xx-0.40)**2/0.19) < 1.0)
lungs = lung_l | lung_r
hu[lungs] = rng.normal(-850, 60, size=int(lungs.sum())).astype(np.float32)

# Mediastinum/kalp ortada
med = (np.abs(xx) < 0.16) & (yy > -0.15) & body
hu[med] = rng.normal(45, 25, size=int(med.sum())).astype(np.float32)

# Omurga (posterior orta)
spine = ((yy-0.62)**2/0.10 + xx**2/0.05) < 1.0
hu[spine] = rng.normal(350, 80, size=int(spine.sum())).astype(np.float32)
core = ((yy-0.62)**2/0.05 + xx**2/0.025) < 1.0
hu[core] = rng.normal(120, 60, size=int(core.sum())).astype(np.float32)

# Kaburgalar (yay şeklinde kemik yoğunlukları)
ang = np.arctan2(yy, xx)
rr = np.sqrt(r2)
ribs = (np.abs(rr - 0.86) < 0.035) & (np.sin(ang*8) > 0.25) & body
hu[ribs] = rng.normal(500, 120, size=int(ribs.sum())).astype(np.float32)

# Akciğer içi damar dallanmaları (küçük, ~30HU, ince tüpler)
for i in range(60):
    z0 = rng.uniform(0.25, 0.75)*D
    y0 = rng.uniform(-0.55, -0.05)*H + H/2
    x0 = rng.uniform(0.25, 0.55)*W if rng.random()<0.5 else rng.uniform(0.45, 0.75)*W
    t = rng.normal(0,1,3)*np.array([D,H,W])*0.06
    L = int(np.linalg.norm(t))+1
    for s in range(L):
        f = s/L
        pz,py,px = int(z0+t[0]*f), int(y0+t[1]*f), int(x0+t[2]*f)
        if 2<pz<D-2 and 2<py<H-2 and 2<px<W-2:
            hu[pz-1:pz+2, py-1:py+2, px-1:px+2] = rng.normal(30, 15)

# Nodül: sağ akciğerde (simetri için sol da), 12mm, 25HU, hafif düzensiz kenar
def add_nodule(zc, yc, xc, rad_mm, hu_val):
    rz = rad_mm/sz; ry = rad_mm/sy; rx = rad_mm/sx
    z = np.arange(int(zc-3*rz), int(zc+3*rz)+1)
    y = np.arange(int(yc-3*ry), int(yc+3*ry)+1)
    x = np.arange(int(xc-3*rx), int(xc+3*rx)+1)
    Z,Y,X = np.meshgrid(z,y,x, indexing="ij")
    # hafif spiküle kenar
    noise = rng.normal(0, 0.25, size=Z.shape)
    d = np.sqrt(((Z-zc)/rz)**2 + ((Y-yc)/ry)**2 + ((X-xc)/rx)**2) + noise
    m = d < 1.0
    hu[Z[m], Y[m], X[m]] = hu_val
    return (zc,yc,xc)

n1 = add_nodule(int(D*0.45), int(H*0.35), int(W*0.62), 6.0, 25.0)   # 12mm
n2 = add_nodule(int(D*0.55), int(H*0.30), int(W*0.38), 4.5, 30.0)   # 9mm
print("noduller (zyx):", n1, n2, flush=True)

print("resample...", flush=True)
res = model_lib.resample_to_luna16(hu, (sz,sy,sx))
print("resampled", res.shape, flush=True)
t0=time.time()
boxes, scores = model_lib.run_inference(res)
print(f"infer {time.time()-t0:.1f}s · kutu: {len(boxes)}", flush=True)
# nodüllere en yakın kutular
def to_zyx_model(b):
    # resampled_xyz uzay -> orijinal (Z,Y,X): ters çevrim
    return b
for i in scores.argsort()[::-1][:10]:
    print(f"  score={scores[i]:.3f} box_xyzxyz={np.round(boxes[i],1).tolist()}", flush=True)
