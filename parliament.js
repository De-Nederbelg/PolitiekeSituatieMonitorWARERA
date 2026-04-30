const Parliament = (() => {
  function computeLayout(nSeats, innerR, outerR) {
    if (nSeats <= 0) return null;
    for (let nRows = 2; nRows <= 12; nRows++) {
      const rowSpan = outerR - innerR;
      const rowH = rowSpan / Math.max(nRows - 1, 1);
      const dotR = rowH * 0.28;
      const step = dotR * 2 * 1.1;
      const radii = Array.from({ length: nRows }, (_, i) => innerR + rowH * i);
      const caps = radii.map((r) =>
        Math.max(1, Math.floor((Math.PI * r) / step)),
      );
      const total = caps.reduce((a, b) => a + b, 0);
      if (total >= nSeats) {
        const rowSeats = _distributePro(nSeats, caps);
        return { dotR, radii, rowSeats };
      }
    }
    const nRows = 12;
    const rowH = (outerR - innerR) / (nRows - 1);
    const dotR = rowH * 0.28;
    const step = dotR * 2 * 1.1;
    const radii = Array.from({ length: nRows }, (_, i) => innerR + rowH * i);
    const caps = radii.map((r) =>
      Math.max(1, Math.floor((Math.PI * r) / step)),
    );
    const rowSeats = _distributePro(nSeats, caps);
    return { dotR, radii, rowSeats };
  }

  function _distributePro(total, caps) {
    const capSum = caps.reduce((a, b) => a + b, 0);
    const result = new Array(caps.length).fill(0);
    let assigned = 0;
    caps.forEach((cap, i) => {
      if (i === caps.length - 1) {
        result[i] = total - assigned;
      } else {
        const s = Math.min(cap, Math.round((total * cap) / capSum));
        result[i] = s;
        assigned += s;
      }
    });
    let diff = total - result.reduce((a, b) => a + b, 0);
    for (let i = caps.length - 1; i >= 0 && diff !== 0; i--) {
      const canAdd = caps[i] - result[i];
      const canSub = result[i];
      if (diff > 0 && canAdd > 0) {
        const add = Math.min(diff, canAdd);
        result[i] += add;
        diff -= add;
      } else if (diff < 0 && canSub > 0) {
        const sub = Math.min(-diff, canSub);
        result[i] -= sub;
        diff += sub;
      }
    }
    return result;
  }

  function generatePoints(layout) {
    const { radii, rowSeats } = layout;
    const pts = [];
    radii.forEach((radius, row) => {
      const n = rowSeats[row];
      if (n <= 0) return;
      for (let i = 0; i < n; i++) {
        const angle = -Math.PI + Math.PI * (i / (n - 1 || 1));
        pts.push({ angle, radius, row });
      }
    });
    pts.sort((a, b) => a.angle - b.angle);
    return pts;
  }

  function render({ container, legendContainer, parties, tooltip }) {
    container.innerHTML = "";
    legendContainer.innerHTML = "";

    const totalSeats = parties.reduce((s, p) => s + p.seats, 0);
    if (!totalSeats) {
      container.innerHTML = '<p class="empty">Geen zetels beschikbaar.</p>';
      return;
    }

    const W = Math.max(container.clientWidth || 540, 340);
    const H = Math.round(W * 0.55);
    const cx = W / 2;
    const cy = H * 0.9;
    const outerR = Math.min(W * 0.47, H * 0.93);
    const innerR = outerR * 0.24;

    const layout = computeLayout(totalSeats, innerR, outerR);
    if (!layout) return;

    const pts = generatePoints(layout);
    const sorted = [...parties].sort((a, b) => b.seats - a.seats);
    let idx = 0;
    const colored = [];
    sorted.forEach((party) => {
      const users = party.users || [];
      for (let i = 0; i < party.seats; i++) {
        if (idx >= pts.length) break;
        colored.push({
          ...pts[idx],
          party: party.name,
          color: party.color,
          seatIdx: i,
          total: party.seats,
          username: users[i]?.username || null,
          userId: users[i]?.userId || null,
          avatarUrl: users[i]?.avatarUrl || null,
        });
        idx++;
      }
    });

    const svg = d3
      .select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .style("overflow", "visible")
      .style("width", "100%")
      .style("height", "auto");

    const defs = svg.append("defs");
    const avatarPatterns = {};
    colored.forEach((d) => {
      if (d.avatarUrl && !avatarPatterns[d.avatarUrl]) {
        const patternId = "avatar-" + d.userId;
        const pattern = defs
          .append("pattern")
          .attr("id", patternId)
          .attr("patternUnits", "objectBoundingBox")
          .attr("width", 1)
          .attr("height", 1);

        pattern
          .append("image")
          .attr("x", 0)
          .attr("y", 0)
          .attr("width", 1)
          .attr("height", 1)
          .attr("preserveAspectRatio", "xMidYMid slice")
          .attr("href", d.avatarUrl);

        avatarPatterns[d.avatarUrl] = patternId;
      }
    });

    const majority = Math.floor(totalSeats / 2) + 1;
    const majAngle = -Math.PI + Math.PI * (majority / totalSeats);

    svg
      .append("text")
      .attr("x", cx + (outerR + 13) * Math.cos(majAngle))
      .attr("y", cy + (outerR + 13) * Math.sin(majAngle) + 3)
      .attr("fill", "rgba(197,150,74,.7)")
      .attr("font-size", 9)
      .attr("font-family", "Sora, sans-serif")
      .text("50%+1");

    svg
      .selectAll("g.seat-group")
      .data(colored)
      .enter()
      .append("g")
      .attr("class", "seat-group")
      .attr(
        "transform",
        (d) =>
          `translate(${cx + d.radius * Math.cos(d.angle)}, ${cy + d.radius * Math.sin(d.angle)})`,
      )
      .each(function (d) {
        const g = d3.select(this);

        g.append("circle")
          .attr("r", layout.dotR)
          .attr("fill", d.color)
          .attr("stroke", d.color)
          .attr("stroke-width", 3.5);

        if (d.avatarUrl) {
          const clipId =
            "clip-" + d.userId + "-" + Math.random().toString(36).substr(2, 6);
          defs
            .append("clipPath")
            .attr("id", clipId)
            .append("circle")
            .attr("r", layout.dotR - 2);

          g.append("image")
            .attr("x", -(layout.dotR - 2))
            .attr("y", -(layout.dotR - 2))
            .attr("width", (layout.dotR - 2) * 2)
            .attr("height", (layout.dotR - 2) * 2)
            .attr("preserveAspectRatio", "xMidYMid slice")
            .attr("href", d.avatarUrl)
            .attr("clip-path", `url(#${clipId})`);
        }
      })
      .on("mouseover", (event, d) => {
        tooltip.style.opacity = 1;
        const avatarHtml = d.avatarUrl
          ? `<img src="${d.avatarUrl}" class="tooltip-avatar">`
          : "";
        tooltip.innerHTML = `
          <div class="tt-party">${d.party}</div>
          ${d.username ? `<div class="tt-user">${avatarHtml} ${d.username}</div>` : ""}
          <div class="tt-seat">Zetel ${d.seatIdx + 1} / ${d.total}</div>
        `;
      })
      .on("mousemove", (event) => {
        tooltip.style.left = event.clientX + 14 + "px";
        tooltip.style.top = event.clientY - 36 + "px";
      })
      .on("mouseout", () => {
        tooltip.style.opacity = 0;
      })
      .on("click", (event, d) => {
        if (d.userId) {
          window.open(`${APP_BASE}/user/${d.userId}`, "_blank");
        }
      });

    svg
      .append("text")
      .attr("x", cx)
      .attr("y", cy - 6)
      .attr("text-anchor", "middle")
      .attr("fill", "#535e72")
      .attr("font-size", 10)
      .attr("font-family", "Sora, sans-serif")
      .text(`${totalSeats} zetels`);

    sorted.forEach((p) => {
      const el = document.createElement("div");
      el.className = "leg-item";
      el.title = p.name;
      el.innerHTML = `
        <span class="leg-dot" style="background:${p.color}"></span>
        <span>${p.abbr || p.name}</span>
        <span class="leg-seats">${p.seats}</span>
      `;
      legendContainer.appendChild(el);
    });
  }

  return { render };
})();
