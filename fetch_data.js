const axios = require('axios');
const fs = require('fs');

// Thay thế 2 thông tin này của mày vào
const GITHUB_TOKEN = process.env.MY_GIT_TOKEN; // Tạo token cá nhân trên GitHub và gán vào biến môi trường MY_GIT_TOKEN
const USERNAME = 'ThangRiel';

// Dùng GraphQL API của GitHub để lấy bản đồ Contributions chi tiết từng ngày
async function getContributions() {
  const query = `
    query($username: String!) {
      user(login: $username) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
                color
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await axios({
      url: 'https://api.github.com/graphql',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
      },
      data: {
        query: query,
        variables: { username: USERNAME },
      },
    });

    const weeks = response.data.data.user.contributionsCollection.contributionCalendar.weeks;
    let contributionData = [];

    // Duyệt qua từng tuần, từng ngày để lọc ra những ngày có commit/contribution
    weeks.forEach(week => {
      week.contributionDays.forEach(day => {
        if (day.contributionCount > 0) {
          contributionData.push({
            date: day.date,
            count: day.contributionCount,
            color: day.color // Màu xanh đậm hay nhạt của ô đóng góp
          });
        }
      });
    });

    // Ghi dữ liệu ra file JSON để làm "nguyên liệu" cho game sau này
    fs.writeFileSync('contributions.json', JSON.stringify(contributionData, null, 2));
    console.log('Đã cào dữ liệu thành công! Kiểm tra file contributions.json nhé tao.');

  } catch (error) {
    console.error('Lỗi rồi mày ơi:', error.response ? error.response.data : error.message);
  }
}

getContributions();