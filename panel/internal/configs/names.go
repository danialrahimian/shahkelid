package configs

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
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

// ReadableSize writes a size as PasarGuard does: "40 GB", "1.5 KB".
func ReadableSize(bytes int64) string {
	units := []string{"B", "KB", "MB", "GB", "TB"}
	value := math.Max(0, float64(bytes))
	unit := 0
	for value >= 1024 && unit < len(units)-1 {
		value /= 1024
		unit++
	}
	return strconv.FormatFloat(math.Round(value*100)/100, 'f', -1, 64) + " " + units[unit]
}

var statusEmoji = map[string]string{
	"active":   "✅",
	"on_hold":  "🔌",
	"limited":  "🪫",
	"expired":  "⌛️",
	"disabled": "❌",
}

var variable = regexp.MustCompile(`\{([A-Z_]+)\}`)

// tehran is Iran's time zone, for the Persian date; UTC+3:30 if the system
// has no zone database.
var tehran = func() *time.Location {
	if location, err := time.LoadLocation("Asia/Tehran"); err == nil {
		return location
	}
	return time.FixedZone("IRST", 3*3600+1800)
}()

// RenderName fills PasarGuard's remark variables ({DATA_LEFT}, {DAYS_LEFT}…)
// in one of our names, from the subscription as a whole (all its panels
// together). A variable it does not know is left as written.
func RenderName(template string, totals Totals, config Fingerprint, now time.Time) string {
	var left *int64
	if totals.DataLimitBytes != nil {
		v := max(0, *totals.DataLimitBytes-totals.UsedBytes)
		left = &v
	}
	var seconds *float64
	if totals.ExpiresAt != nil {
		v := math.Max(0, totals.ExpiresAt.Sub(now).Seconds())
		seconds = &v
	} else if totals.OnHoldDurationSeconds != nil {
		v := float64(*totals.OnHoldDurationSeconds)
		seconds = &v
	}
	infinite := "∞"
	values := map[string]string{
		"USERNAME":           totals.Username,
		"DATA_USAGE":         ReadableSize(totals.UsedBytes),
		"DATA_LEFT":          infinite,
		"DATA_LIMIT":         infinite,
		"DAYS_LEFT":          infinite,
		"TIME_LEFT":          infinite,
		"EXPIRE_DATE":        infinite,
		"STATUS_EMOJI":       statusEmoji[totals.Status],
		"STATUS_TEXT":        totals.Status,
		"PROTOCOL":           deref(config.Protocol),
		"TRANSPORT":          deref(config.Network),
		"SERVER_IP":          deref(config.Server),
		"USAGE_PERCENTAGE":   "0",
		"JALALI_EXPIRE_DATE": infinite,
	}
	if left != nil {
		values["DATA_LEFT"] = ReadableSize(*left)
	}
	if totals.DataLimitBytes != nil {
		values["DATA_LIMIT"] = ReadableSize(*totals.DataLimitBytes)
		if *totals.DataLimitBytes > 0 {
			percent := math.Min(100, math.Round(float64(totals.UsedBytes)/float64(*totals.DataLimitBytes)*100))
			values["USAGE_PERCENTAGE"] = strconv.Itoa(int(percent))
		}
	}
	if seconds != nil {
		days := int64(*seconds / 86400)
		values["DAYS_LEFT"] = strconv.FormatInt(days, 10)
		total := int64(*seconds)
		if days > 0 {
			values["TIME_LEFT"] = fmt.Sprintf("%dd %dh", days, total%86400/3600)
		} else {
			values["TIME_LEFT"] = fmt.Sprintf("%dh %dm", total/3600, total%3600/60)
		}
	}
	if totals.ExpiresAt != nil {
		values["EXPIRE_DATE"] = totals.ExpiresAt.UTC().Format("2006-01-02")
		y, m, d := ToJalali(totals.ExpiresAt.In(tehran))
		values["JALALI_EXPIRE_DATE"] = fmt.Sprintf("%04d/%02d/%02d", y, m, d)
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
