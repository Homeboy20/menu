with open(r"e:\backup files\menu\customer-dashboard.html", "rb") as f:
    raw = f.read()

idx = raw.find(b"handlePlanClick(")
chunks = []
while idx != -1:
    end = raw.find(b")", idx)
    print(repr(raw[idx:end+1]))
    idx = raw.find(b"handlePlanClick(", idx+1)
