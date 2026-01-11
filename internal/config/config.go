package config

import (
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	Logging  LoggingConfig  `yaml:"logging"`
	Queue    QueueConfig    `yaml:"queue"`
	Audio    AudioConfig    `yaml:"audio"`
	Security SecurityConfig `yaml:"security"`
}

type ServerConfig struct {
	Port         int           `yaml:"port"`
	Host         string        `yaml:"host"`
	ReadTimeout  time.Duration `yaml:"read_timeout"`
	WriteTimeout time.Duration `yaml:"write_timeout"`
}

type DatabaseConfig struct {
	Path         string `yaml:"path"`
	MaxOpenConns int    `yaml:"max_open_conns"`
	MaxIdleConns int    `yaml:"max_idle_conns"`
}

type LoggingConfig struct {
	Level    string `yaml:"level"`
	Output   string `yaml:"output"`
	FilePath string `yaml:"file_path"`
}

type QueueConfig struct {
	Prefix          string `yaml:"prefix"`
	StartNumber     int    `yaml:"start_number"`
	ResetDaily      bool   `yaml:"reset_daily"`
	AutoCancelHours int    `yaml:"auto_cancel_hours"`
}

type AudioConfig struct {
	Enabled  bool   `yaml:"enabled"`
	BellFile string `yaml:"bell_file"`
}

type SecurityConfig struct {
	AdminPassword  string `yaml:"admin_password"`
	SessionTimeout int    `yaml:"session_timeout"`
}

func DefaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Port:         8080,
			Host:         "0.0.0.0",
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 30 * time.Second,
		},
		Database: DatabaseConfig{
			Path:         "./data/queue.db",
			MaxOpenConns: 25,
			MaxIdleConns: 5,
		},
		Logging: LoggingConfig{
			Level:    "info",
			Output:   "stdout",
			FilePath: "./data/logs/app.log",
		},
		Queue: QueueConfig{
			Prefix:          "A",
			StartNumber:     1,
			ResetDaily:      true,
			AutoCancelHours: 24,
		},
		Audio: AudioConfig{
			Enabled:  true,
			BellFile: "/static/audio/bell.mp3",
		},
		Security: SecurityConfig{
			AdminPassword:  "admin123",
			SessionTimeout: 3600,
		},
	}
}

func Load(path string) (*Config, error) {
	cfg := DefaultConfig()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return nil, err
	}

	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}

	return cfg, nil
}

func (c *Config) Save(path string) error {
	data, err := yaml.Marshal(c)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
