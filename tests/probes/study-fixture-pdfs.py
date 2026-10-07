"""Make two study PDFs with bookmarks for tests/probes/study-app-probe.mjs.

Clark (14 pages, four bookmarked chapters) and Mack (6 pages, two), each
chapter running over several pages with a "(continued)" running header, so
the probe can check the chapters come from the bookmarks, not the headers.

python3 tests/probes/study-fixture-pdfs.py <outdir>
"""
import sys, os
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

CLARK = [
  ("1. Introduction", [
    "Loss reserving estimates the unpaid portion of claims that have already occurred.",
    "This paper models the expected emergence of losses with a growth curve fitted by maximum likelihood.",
    "The approach gives a distribution of the reserve, not only a point estimate, which is useful for setting ranges.",
    "Two methods are compared: the LDF method and the Cape Cod method.",
  ]),
  ("2. Growth Curves and the LDF Method", [
    "The growth curve G(x) describes the cumulative percentage of ultimate loss reported by age x.",
    "The loglogistic curve is G(x) = x^w / (x^w + theta^w), with two parameters omega and theta.",
    "The Weibull curve is G(x) = 1 - exp(-(x/theta)^w) and generally has a lighter tail than the loglogistic.",
    "The loglogistic curve has a heavier tail than the Weibull, which is why a truncation point is often needed.",
    "The LDF method estimates a separate ultimate loss for each accident year in addition to the two curve parameters.",
    "Using average accident dates rather than the start of the year shifts the curve by half a year.",
  ]),
  ("3. The Cape Cod Method", [
    "The Cape Cod method assumes that the expected ultimate loss for each year is a constant expected loss ratio applied to the year's on-level premium.",
    "The whole triangle is then fit with only three parameters: omega, theta and the expected loss ratio.",
    "Fewer parameters means more degrees of freedom in the data and, in general, a smaller parameter variance.",
    "The cost is the assumption that the loss ratio is stable across accident years after adjusting premium to a common level.",
    "Clark prefers the Cape Cod method when the data triangle is small, because the LDF method overparameterizes it.",
    "The expected incremental loss is the premium times the expected loss ratio times the change in the growth curve over the period.",
  ]),
  ("4. Variance of the Reserve Estimate", [
    "The total variance of the reserve is the sum of the process variance and the parameter variance.",
    "Process variance is the random variation in the losses themselves around their expected value.",
    "Parameter variance is the uncertainty in the fitted parameters, estimated from the information matrix.",
    "The scale factor sigma squared is estimated as the chi-square statistic divided by the degrees of freedom.",
    "The degrees of freedom equal the number of data points in the triangle less the number of fitted parameters.",
    "Incremental losses are assumed to follow an over-dispersed Poisson distribution with variance proportional to the mean.",
    "Residuals plotted against increment age, expected loss and calendar period test whether the model fits.",
  ]),
]

MACK = [
  ("1. The Chain Ladder Assumptions", [
    "Mack shows that the chain ladder method rests on three implicit assumptions about cumulative losses.",
    "The expected cumulative loss at the next age equals the current cumulative loss times a development factor that depends only on the age.",
    "The accident years are independent of each other.",
    "The variance of the next cumulative loss is proportional to the current cumulative loss, with a factor sigma squared that depends only on the age.",
  ]),
  ("2. The Standard Error of the Reserve", [
    "The mean squared error of the reserve combines the process error and the estimation error.",
    "The development factors are estimated as volume-weighted averages, which are unbiased under the assumptions.",
    "The last sigma squared cannot be estimated from the data and is extrapolated from the earlier ones.",
    "A confidence interval for the reserve can be set with a lognormal distribution matched to the mean and standard error.",
  ]),
]

def write(path, title, chapters, pages_per_chapter):
  c = canvas.Canvas(path, pagesize=letter)
  c.setTitle(title)
  page = 0
  for ci, (heading, sentences) in enumerate(chapters):
    n = pages_per_chapter[ci]
    per = max(1, (len(sentences) + n - 1) // n)
    for pi in range(n):
      page += 1
      key = f"ch{ci}p{pi}"
      c.bookmarkPage(key)
      if pi == 0:
        c.addOutlineEntry(heading, key, level=0)
      y = 720
      c.setFont("Times-Bold", 15 if pi == 0 else 11)
      c.drawString(72, y, heading if pi == 0 else f"{heading} (continued)")
      y -= 30
      c.setFont("Times-Roman", 11)
      chunk = sentences[pi * per:(pi + 1) * per] or sentences[-1:]
      for s in chunk:
        # wrap at ~95 chars
        words, line = s.split(), ""
        for w in words:
          if len(line) + len(w) + 1 > 92:
            c.drawString(72, y, line); y -= 15; line = w
          else:
            line = (line + " " + w).strip()
        if line:
          c.drawString(72, y, line); y -= 15
        y -= 8
      c.setFont("Times-Roman", 9)
      c.drawString(300, 40, str(page))
      c.showPage()
  c.save()

write(os.path.join(OUT, "Clark_2003_LDF_Curve_Fitting.pdf"), "Clark 2003", CLARK, [2, 4, 4, 4])
write(os.path.join(OUT, "Mack_1994_Chain_Ladder.pdf"), "Mack 1994", MACK, [3, 3])
print("ok")
