package configs

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Totals is the subscription as a whole, for the variables in our names.
type Totals struct {
	Username              string
	Status                string
	UsedBytes             int64
	DataLimitBytes        *int64
	ExpiresAt             *time.Time
	OnHoldDurationSeconds *int64
}

// pyRound rounds as Python's round(x, 2) does and prints the result as
// Python prints a float: "40.0", "1.5", "0.33".
func pyRound(x float64) string {
	rounded, _ := strconv.ParseFloat(strconv.FormatFloat(x, 'f', 2, 64), 64)
	text := strconv.FormatFloat(rounded, 'f', -1, 64)
	if !strings.ContainsAny(text, ".eE") {
		text += ".0"
	}
	return text
}

// ReadableSize writes a size exactly as PasarGuard does (readable_size in
// app/utils/system.py): "40.0 GB", "1.5 KB", "0 B".
func ReadableSize(bytes int64) string {
	if bytes <= 0 {
		return "0 B"
	}
	units := []string{"B", "KB", "MB", "GB", "TB", "PB", "EB"}
	i := int(math.Floor(math.Log(float64(bytes)) / math.Log(1024)))
	i = min(max(i, 0), len(units)-1)
	return pyRound(float64(bytes)/math.Pow(1024, float64(i))) + " " + units[i]
}

// timeLeft writes a duration as PasarGuard does (format_time_left in
// app/subscription/share.py): months of 30 days, days, hours under a week,
// minutes under a day.
func timeLeft(seconds float64) string {
	if seconds <= 0 {
		return "∞"
	}
	minutes := math.Floor(seconds / 60)
	hours := math.Floor(minutes / 60)
	minutes -= hours * 60
	days := math.Floor(hours / 24)
	hours -= days * 24
	months := math.Floor(days / 30)
	days -= months * 30
	var parts []string
	if months > 0 {
		parts = append(parts, fmt.Sprintf("%dm", int(months)))
	}
	if days > 0 {
		parts = append(parts, fmt.Sprintf("%dd", int(days)))
	}
	if hours > 0 && days < 7 {
		parts = append(parts, fmt.Sprintf("%dh", int(hours)))
	}
	if minutes > 0 && months == 0 && days == 0 {
		parts = append(parts, fmt.Sprintf("%dm", int(minutes)))
	}
	return strings.Join(parts, " ")
}

var statusEmoji = map[string]string{
	"active":   "✅",
	"on_hold":  "🔌",
	"limited":  "🪫",
	"expired":  "⌛️",
	"disabled": "❌",
}

var variable = regexp.MustCompile(`\{([A-Z_0-9]+)\}`)

// RenderName fills PasarGuard's remark variables in one of our names,
// written exactly as PasarGuard writes them (setup_format_variables in
// app/subscription/share.py), from the subscription as a whole: all its
// panels together. A variable it does not know is left as written.
func RenderName(template string, totals Totals, config Fingerprint, now time.Time) string {
	infinite := "∞"
	values := map[string]string{
		"USERNAME":           totals.Username,
		"DATA_USAGE":         ReadableSize(totals.UsedBytes),
		"DATA_LIMIT":         infinite,
		"DATA_LEFT":          infinite,
		"USAGE_PERCENTAGE":   infinite,
		"DAYS_LEFT":          infinite,
		"TIME_LEFT":          infinite,
		"EXPIRE_DATE":        infinite,
		"JALALI_EXPIRE_DATE": infinite,
		"STATUS_EMOJI":       statusEmoji[totals.Status],
		"STATUS_TEXT":        totals.Status,
		"PROTOCOL":           deref(config.Protocol),
		"TRANSPORT":          "tcp",
		"SERVER_IP":          deref(config.Server),
	}
	if config.Network != nil {
		values["TRANSPORT"] = *config.Network
	}
	if limit := totals.DataLimitBytes; limit != nil && *limit > 0 {
		values["DATA_LIMIT"] = ReadableSize(*limit)
		values["DATA_LEFT"] = ReadableSize(max(*limit-totals.UsedBytes, 0))
		values["USAGE_PERCENTAGE"] = pyRound(float64(totals.UsedBytes) / float64(*limit) * 100)
	}
	switch {
	case totals.Status == "on_hold":
		if hold := totals.OnHoldDurationSeconds; hold != nil && *hold > 0 {
			values["DAYS_LEFT"] = strconv.FormatInt(*hold/86400, 10)
			values["TIME_LEFT"] = timeLeft(float64(*hold))
			values["EXPIRE_DATE"], values["JALALI_EXPIRE_DATE"] = "-", "-"
		}
	case totals.ExpiresAt != nil:
		expires := totals.ExpiresAt.UTC()
		values["EXPIRE_DATE"] = expires.Format("2006-01-02")
		y, m, d := ToJalali(expires)
		values["JALALI_EXPIRE_DATE"] = fmt.Sprintf("%04d-%02d-%02d", y, m, d)
		if now.Before(expires) {
			left := expires.Sub(now)
			values["DAYS_LEFT"] = strconv.FormatInt(int64(left/(24*time.Hour))+1, 10)
			values["TIME_LEFT"] = timeLeft(left.Seconds())
		} else {
			values["DAYS_LEFT"], values["TIME_LEFT"] = "0", "0"
		}
	}
	return variable.ReplaceAllStringFunc(template, func(whole string) string {
		if value, ok := values[whole[1:len(whole)-1]]; ok {
			return value
		}
		return whole
	})
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ToJalali gives the Persian (Solar Hijri) calendar date of a day, by the
// usual arithmetic (as in jalaali-js).
func ToJalali(at time.Time) (year, month, day int) {
	gy, gm, gd := at.Date()
	jdn := gregorianToDay(gy, int(gm), gd)
	return dayToJalali(jdn)
}

func div(a, b int) int { return a / b }

func mod(a, b int) int { return a - a/b*b }

func gregorianToDay(gy, gm, gd int) int {
	d := div((gy+div(gm-8, 6)+100100)*1461, 4) + div(153*mod(gm+9, 12)+2, 5) + gd - 34840408
	return d - div(div(gy+100100+div(gm-8, 6), 100)*3, 4) + 752
}

// jalCal says, for a Persian year, the Gregorian year it starts in, the
// day of March it starts on, and its place in the leap cycle.
func jalCal(jy int) (gy, march, leap int) {
	breaks := []int{-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178}
	gy = jy + 621
	leapJ := -14
	jp := breaks[0]
	jump := 0
	for i := 1; i < len(breaks); i++ {
		jm := breaks[i]
		jump = jm - jp
		if jy < jm {
			break
		}
		leapJ += div(jump, 33)*8 + div(mod(jump, 33), 4)
		jp = jm
	}
	n := jy - jp
	leapJ += div(n, 33)*8 + div(mod(n, 33)+3, 4)
	if mod(jump, 33) == 4 && jump-n == 4 {
		leapJ++
	}
	leapG := div(gy, 4) - div((div(gy, 100)+1)*3, 4) - 150
	march = 20 + leapJ - leapG
	if jump-n < 6 {
		n = n - jump + div(jump+4, 33)*33
	}
	leap = mod(mod(n+1, 33)-1, 4)
	if leap == -1 {
		leap = 4
	}
	return gy, march, leap
}

func dayToJalali(jdn int) (int, int, int) {
	gy, _, _ := dayToGregorian(jdn)
	jy := gy - 621
	_, march, leap := jalCal(jy)
	jdn1f := gregorianToDay(gy, 3, march)
	k := jdn - jdn1f
	if k >= 0 {
		if k <= 185 {
			return jy, 1 + div(k, 31), mod(k, 31) + 1
		}
		k -= 186
	} else {
		jy--
		k += 179
		if leap == 1 {
			k++
		}
	}
	return jy, 7 + div(k, 30), mod(k, 30) + 1
}

func dayToGregorian(jdn int) (int, int, int) {
	j := 4*jdn + 139361631
	j = j + div(div(4*jdn+183187720, 146097)*3, 4)*4 - 3908
	i := div(mod(j, 1461), 4)*5 + 308
	gd := div(mod(i, 153), 5) + 1
	gm := mod(div(i, 153), 12) + 1
	gy := div(j, 1461) - 100100 + div(8-gm, 6)
	return gy, gm, gd
}
